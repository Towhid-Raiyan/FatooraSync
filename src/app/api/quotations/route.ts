import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { round2, round3, calculateLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import { withTenant } from "@/lib/db/tenant-context";
import { PAGE_SIZE } from "@/lib/receipts/constants";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { parseQuotationNumberQuery, extractQuotationNumberPrefix, quotationNumberPrefixRanges } from "@/lib/quotations/quotation-number";

class QuotationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RawLine {
  productId?: unknown;
  quantity?: unknown;
  discount?: unknown;
  unitPrice?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const body = await request.json();
  const deviceId = request.headers.get("X-Device-Id");
  const preAssigned = body.preAssigned as { number: number; uuid: string } | undefined;

  const rawLines: RawLine[] = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "Add at least one item" }, { status: 400 });
  }

  const parsedLines: {
    productId: string;
    quantity: number;
    discount: number;
    unitPriceOverride: number | null;
  }[] = [];
  for (const line of rawLines) {
    const quantity = Number(line.quantity);
    const discount =
      line.discount === undefined || line.discount === "" ? 0 : round2(Number(line.discount));
    // Same client-trust exception as the receipt save (src/app/api/receipts/route.ts):
    // unitPrice is the one field a cashier can override at the point of quoting;
    // productName/vatRate are always the server's own fresh read.
    const unitPriceOverride =
      line.unitPrice === undefined || line.unitPrice === null ? null : round3(Number(line.unitPrice));
    if (typeof line.productId !== "string" || !Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Each item must have a positive quantity" }, { status: 400 });
    }
    if (!Number.isFinite(discount) || discount < 0) {
      return NextResponse.json({ error: "Discount must be zero or more" }, { status: 400 });
    }
    if (unitPriceOverride !== null && (!Number.isFinite(unitPriceOverride) || unitPriceOverride < 0)) {
      return NextResponse.json({ error: "Unit price must be zero or more" }, { status: 400 });
    }
    parsedLines.push({ productId: line.productId, quantity, discount, unitPriceOverride });
  }

  const customerDraft = body.customer ?? {};
  const draftName = typeof customerDraft.name === "string" ? customerDraft.name.trim() : "";
  const draftVatId = typeof customerDraft.vatId === "string" ? customerDraft.vatId.trim() : "";
  const hasFullCustomer = draftName.length > 0 && draftVatId.length > 0;

  const trimmedNotes = typeof body.notes === "string" ? body.notes.trim() : "";
  const notes = trimmedNotes || null;

  try {
    const result = await prisma.$transaction(async (txn) => {
      const settings = await txn.settings.findUniqueOrThrow({ where: { tenantId } });

      if (preAssigned?.uuid) {
        const existing = await txn.document.findFirst({
          where: { tenantId, uuid: preAssigned.uuid },
          include: { lines: true },
        });
        if (existing) {
          return { existing, isRetry: true } as const;
        }
      }

      const resolvedLines: {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        discount: number;
        vatRate: number;
        lineSubtotal: number;
        lineVat: number;
        lineTotal: number;
      }[] = [];

      for (const line of parsedLines) {
        const product = await txn.product.findFirst({
          where: { id: line.productId, tenantId, isActive: true },
        });
        if (!product) {
          throw new QuotationError("One or more items are no longer available", 400);
        }
        const unitPrice = line.unitPriceOverride ?? Number(product.unitPrice);
        const rawSubtotal = round2(unitPrice * line.quantity);
        if (line.discount > rawSubtotal) {
          throw new QuotationError("Discount cannot exceed the item's subtotal", 400);
        }
        const vatRate = product.vatRate !== null ? Number(product.vatRate) : Number(settings.defaultVatRate);
        const { lineSubtotal, lineVat, lineTotal } = calculateLine({
          unitPrice,
          quantity: line.quantity,
          vatRate,
          discount: line.discount,
        });
        resolvedLines.push({
          productId: product.id,
          productName: product.nameEn,
          quantity: line.quantity,
          unitPrice,
          discount: line.discount,
          vatRate,
          lineSubtotal,
          lineVat,
          lineTotal,
        });
      }

      const { subtotal, vatTotal, grandTotal } = calculateDocumentTotals(resolvedLines);

      // Same row-lock-before-customer-resolve ordering as the receipt save, for the
      // same reason: this takes a row lock on the tenant for the rest of the
      // transaction, so two concurrent saves that both type a brand-new VAT ID can
      // never both miss the find-or-create lookup below and race into `create`.
      let number: number;
      if (preAssigned) {
        if (!deviceId) {
          throw new QuotationError("X-Device-Id header is required with a pre-assigned number", 400);
        }
        const lease = await txn.numberLease.findFirst({
          where: {
            tenantId,
            deviceId,
            documentType: "QUOTATION",
            rangeStart: { lte: preAssigned.number },
            rangeEnd: { gte: preAssigned.number },
          },
        });
        if (!lease) {
          throw new QuotationError("This number was not leased to your device", 409);
        }
        const alreadyUsed = await txn.document.findFirst({ where: { tenantId, type: "QUOTATION", number: preAssigned.number } });
        if (alreadyUsed) {
          throw new QuotationError("This number has already been used", 409);
        }
        number = preAssigned.number;
        // Same row lock as the `else` branch's counter-incrementing `update`
        // below -- `increment: 0` is a no-op on the stored value but still
        // issues a real UPDATE, so two concurrent preAssigned saves for this
        // tenant can't both miss the customer find-or-create lookup below and
        // race into `create`. There's no hash chain to protect here (unlike
        // the receipt save), but the same customer-race-safety concern applies.
        await txn.tenant.update({
          where: { id: tenantId },
          data: { nextQuotationNumber: { increment: 0 } },
          select: { nextQuotationNumber: true },
        });
      } else {
        const tenantCounters = await txn.tenant.update({
          where: { id: tenantId },
          data: { nextQuotationNumber: { increment: 1 } },
          select: { nextQuotationNumber: true },
        });
        number = tenantCounters.nextQuotationNumber - 1;
      }

      let customerId: string;
      if (hasFullCustomer) {
        const existing = await txn.customer.findFirst({
          where: { tenantId, vatId: draftVatId, isActive: true },
        });
        if (existing) {
          customerId = existing.id;
        } else {
          const inactive = await txn.customer.findFirst({
            where: { tenantId, vatId: draftVatId, isActive: false },
          });
          if (inactive) {
            const reactivated = await txn.customer.update({
              where: { id: inactive.id },
              data: { isActive: true },
            });
            customerId = reactivated.id;
          } else {
            const created = await txn.customer.create({
              data: {
                tenantId,
                name: draftName,
                vatId: draftVatId,
                crNumber: typeof customerDraft.crNumber === "string" ? customerDraft.crNumber.trim() || null : null,
                phone: typeof customerDraft.phone === "string" ? customerDraft.phone.trim() || null : null,
                address: typeof customerDraft.address === "string" ? customerDraft.address.trim() || null : null,
              } as Prisma.CustomerUncheckedCreateInput,
            });
            customerId = created.id;
          }
        }
      } else {
        let walkIn = await txn.customer.findFirst({ where: { tenantId, isWalkIn: true } });
        if (!walkIn) {
          walkIn = await txn.customer.create({
            data: { tenantId, name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput,
          });
        }
        customerId = walkIn.id;
      }

      const createdAt = new Date();

      // No stock decrement here (contrast with the receipt save's per-line
      // `txn.product.update({ data: { quantity: { decrement } } })` loop) -- a
      // quotation is an estimate, not a completed sale. No invoiceHash /
      // previousInvoiceHash / qrCode either -- those are simply omitted, leaving
      // them null.
      const created = await txn.document.create({
        data: {
          tenantId,
          type: "QUOTATION",
          number,
          customerId,
          subtotal,
          vatTotal,
          grandTotal,
          notes,
          uuid: preAssigned?.uuid,
          createdAt,
          lines: {
            create: resolvedLines.map((line) => ({
              tenantId,
              productId: line.productId,
              productName: line.productName,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount,
              vatRate: line.vatRate,
              lineSubtotal: line.lineSubtotal,
              lineVat: line.lineVat,
              lineTotal: line.lineTotal,
            })),
          },
        } as Prisma.DocumentUncheckedCreateInput,
        include: { lines: true },
      });

      return { existing: created, isRetry: false } as const;
    }, { timeout: 15000, maxWait: 5000 });

    const { existing: document, isRetry } = result;
    return NextResponse.json(document, { status: isRetry ? 200 : 201 });
  } catch (err) {
    if (err instanceof QuotationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Two different unique constraints can raise P2002 here: Customer's
      // `@@unique([tenantId, vatId])` (the long-standing case) and Document's
      // `@@unique([tenantId, type, number])` -- the latter is reachable now
      // that a `preAssigned` number's app-level `alreadyUsed` check (above)
      // can lose a race to a near-simultaneous duplicate submission and fall
      // through to the DB constraint as the last line of defense. `meta.target`
      // identifies which constraint fired; Prisma reports it as either an
      // array of column names or (for some engine/DB combinations) a single
      // constraint-name string, so this checks for "number" as a substring of
      // either shape rather than assuming one specific format.
      const target = err.meta?.target;
      const targetDescription = Array.isArray(target) ? target.join(",") : String(target ?? "");
      if (targetDescription.includes("number")) {
        return NextResponse.json({ error: "This number has already been used" }, { status: 409 });
      }
      return NextResponse.json({ error: "This VAT ID is already used by another customer" }, { status: 409 });
    }
    throw err;
  }
}

function parseDateOrNull(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const pageParam = Number(url.searchParams.get("page"));
  const page =
    Number.isFinite(pageParam) && pageParam >= 1 ? Math.min(Math.floor(pageParam), 1_000_000) : 1;

  const search = url.searchParams.get("search")?.trim() || "";
  // Distinct from `search`: a number-*prefix* lookup, used by the New Receipt
  // page's "load from quotation" search for live, narrowing-as-you-type
  // suggestions (typing "QTE1" should show 1, 10-19, 100-199, ... immediately,
  // not just an exact "QTE1" hit). This must never also match on a customer
  // name/VAT-ID substring the way the general `search` param does (a numeric
  // query like "4" would otherwise also match any customer whose VAT ID
  // happens to contain a "4").
  const numberPrefixParam = url.searchParams.get("numberPrefix");
  const startOfDay = parseDateOrNull(url.searchParams.get("dateFrom"));
  const endOfDay = parseDateOrNull(url.searchParams.get("dateTo"));
  if (endOfDay) {
    endOfDay.setUTCHours(23, 59, 59, 999);
  }

  // `tenantId` is deliberately absent from this `where` -- withTenant() injects it.
  const where: Prisma.DocumentWhereInput = {
    type: "QUOTATION",
  };
  if (startOfDay || endOfDay) {
    where.createdAt = {
      ...(startOfDay ? { gte: startOfDay } : {}),
      ...(endOfDay ? { lte: endOfDay } : {}),
    };
  }
  if (numberPrefixParam !== null) {
    const digits = extractQuotationNumberPrefix(numberPrefixParam);
    const ranges = digits ? quotationNumberPrefixRanges(digits) : [];
    if (ranges.length > 0) {
      where.OR = ranges.map((range) => ({ number: { gte: range.gte, lte: range.lte } }));
    } else {
      // No digits typed yet (digits === "") or an unparsable prefix (digits
      // === null) -- -1 never matches a real Document.number, rather than
      // relying on an empty OR array's match-nothing-vs-match-everything
      // semantics, which differ across Prisma versions.
      where.number = -1;
    }
  } else if (search) {
    // Accepts "QTE132"/"qte132"/"#132" as well as a bare "132" -- a 15-digit VAT
    // ID also passes the digit-only check inside this parser, so it's clamped to
    // the INT4 range and falls through to the `contains` branches below instead
    // of throwing.
    const parsedNumber = parseQuotationNumberQuery(search);
    where.OR = [
      ...(parsedNumber !== null ? [{ number: parsedNumber }] : []),
      { customer: { name: { contains: search, mode: "insensitive" } } },
      { customer: { vatId: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [total, documents] = await withTenant(tenantId, (txn) =>
    Promise.all([
      txn.document.count({ where }),
      txn.document.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          number: true,
          grandTotal: true,
          createdAt: true,
          customer: { select: { name: true, vatId: true } },
        },
      }),
    ])
  );

  const quotations = documents.map((doc) => ({
    id: doc.id,
    number: doc.number,
    customerName: doc.customer.name,
    customerVatId: doc.customer.vatId,
    createdAt: doc.createdAt.toISOString(),
    grandTotal: doc.grandTotal.toString(),
  }));

  return NextResponse.json({ quotations, total, page, pageSize: PAGE_SIZE });
}
