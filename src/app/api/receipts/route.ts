import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { round2, round3, calculateLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import { computeInvoiceHash, GENESIS_HASH } from "@/lib/zatca/hash-chain";
import { buildZatcaQrPayload } from "@/lib/zatca/qr-payload";
import { withTenant } from "@/lib/db/tenant-context";
import { PAGE_SIZE } from "@/lib/receipts/constants";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { applyStockMovement } from "@/lib/inventory/apply-stock-movement";

class ReceiptError extends Error {
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
  if (!session?.user?.tenantId || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const userId = session.user.id;
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
    // `unitPrice` is the one exception to "never trust the client for price" (see
    // the note above the per-line resolution loop below): a cashier can override a
    // line's price at the point of sale, so an explicit value here is honored
    // instead of always re-reading the catalog price. Only `undefined`/`null` --
    // the field genuinely not supplied -- falls back to the catalog price. An
    // empty string is deliberately NOT treated the same as "not supplied": the
    // client always sends the line's current on-screen Unit Price, so `""` means
    // the cashier cleared that field, which `Number("")` parses as `0` -- a real
    // free-item override, matching what the client is already displaying for that
    // line (a $0 total). Falling back to the catalog price for `""` would silently
    // save a different amount than what was shown on screen before saving.
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

  // Customer: a flat { name, vatId, crNumber, phone, address } draft, not a
  // customerId/newCustomer split -- see docs/specs/2026-08-10-fatoorasync-sales-receipt-design.md
  // for the full resolution rule this implements.
  const customerDraft = body.customer ?? {};
  const draftName = typeof customerDraft.name === "string" ? customerDraft.name.trim() : "";
  const draftVatId = typeof customerDraft.vatId === "string" ? customerDraft.vatId.trim() : "";
  const hasFullCustomer = draftName.length > 0 && draftVatId.length > 0;

  const trimmedNotes = typeof body.notes === "string" ? body.notes.trim() : "";
  const notes = trimmedNotes || null;

  try {
    // This transaction does ~8-10 sequential round trips (settings read, one
    // product read per line, two tenant updates, the customer resolve, the
    // document create, and one product update per line). Prisma's default
    // interactive-transaction timeout (5000ms) is tight for that even on a warm
    // connection, and Neon's serverless compute can add multi-second latency to the
    // first query after it's been idle. A longer timeout avoids spurious "Transaction
    // already closed" failures without changing any transactional logic.
    //
    // `maxWait` is a separate, easy-to-miss setting: it bounds how long Prisma will
    // wait to acquire a pooled connection *before* the transaction even starts, and
    // defaults to only 2000ms. Neon's serverless compute can take longer than that
    // to wake from idle, which surfaced as a P2028 "Unable to start a transaction in
    // the given time" on essentially every save after a few minutes of inactivity --
    // not a data problem, a too-short wait for a cold database. Deliberately kept
    // well short of `timeout` below, not raised to match it: the two wait
    // sequentially (worst case is maxWait + timeout before a save fails outright),
    // and a cold-start reconnect is normally well under a couple of seconds even
    // when it's slow, so 5s covers that with headroom without leaving a cashier
    // staring at a spinner for 30s on a genuinely stuck request.
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

      // Trust boundary: `productName` and `vatRate` are always the server's own fresh
      // read of the product/settings -- never anything from the request body. `unitPrice`
      // is the deliberate exception: a cashier is allowed to override a line's price at
      // the point of sale (e.g. a manual discount negotiated in person), so a
      // client-supplied value is honored here instead of being discarded. What still
      // can't happen is the client picking which *product* or *tax rate* applies --
      // those are always resolved from this fresh, tenant-scoped read.
      for (const line of parsedLines) {
        const product = await txn.product.findFirst({
          where: { id: line.productId, tenantId, isActive: true },
        });
        if (!product) {
          throw new ReceiptError("One or more items are no longer available", 400);
        }
        const unitPrice = line.unitPriceOverride ?? Number(product.unitPrice);
        const rawSubtotal = round2(unitPrice * line.quantity);
        if (line.discount > rawSubtotal) {
          throw new ReceiptError("Discount cannot exceed the item's subtotal", 400);
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

      // Consuming the next receipt number takes a row lock on this tenant for the
      // rest of the transaction (see the numbering comment below). Resolving the
      // customer only *after* that lock -- rather than before, where an earlier
      // version of this route did it -- means two concurrent saves that both type a
      // brand-new VAT ID can never both miss the find-or-create lookup and race each
      // other into `create`: the second save blocks here until the first commits,
      // so by the time it reaches the customer lookup below, the first save's new
      // customer row is already visible to it.
      let number: number;
      let previousInvoiceHash: string;
      if (preAssigned) {
        if (!deviceId) {
          throw new ReceiptError("X-Device-Id header is required with a pre-assigned number", 400);
        }
        const lease = await txn.numberLease.findFirst({
          where: {
            tenantId,
            deviceId,
            documentType: "SALES_RECEIPT",
            rangeStart: { lte: preAssigned.number },
            rangeEnd: { gte: preAssigned.number },
          },
        });
        if (!lease) {
          throw new ReceiptError("This number was not leased to your device", 409);
        }
        const alreadyUsed = await txn.document.findFirst({ where: { tenantId, type: "SALES_RECEIPT", number: preAssigned.number } });
        if (alreadyUsed) {
          throw new ReceiptError("This number has already been used", 409);
        }
        number = preAssigned.number;
        const tenantForHash = await txn.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { lastSalesReceiptHash: true } });
        previousInvoiceHash = tenantForHash.lastSalesReceiptHash ?? GENESIS_HASH;
      } else {
        const tenantCounters = await txn.tenant.update({
          where: { id: tenantId },
          data: { nextSalesReceiptNumber: { increment: 1 } },
          select: { nextSalesReceiptNumber: true, lastSalesReceiptHash: true },
        });
        number = tenantCounters.nextSalesReceiptNumber - 1;
        previousInvoiceHash = tenantCounters.lastSalesReceiptHash ?? GENESIS_HASH;
      }

      let customerId: string;
      if (hasFullCustomer) {
        // Find-or-create by VAT ID: the cashier may have picked a suggestion (in
        // which case these fields already exactly match a stored customer) or typed
        // the VAT ID manually without using the suggestion dropdown. Either way, VAT
        // ID is the tenant-unique key, so look up first rather than blindly creating
        // -- this also means any edits to the other fields after a match are silently
        // ignored in favor of the stored record, which is deliberate: a receipt save
        // is not a customer-editing flow, and VAT ID/legal name are treated as fixed
        // facts here, not something a cashier can casually overwrite mid-sale.
        // Deactivated customers are excluded from the primary match -- their VAT ID
        // shouldn't silently attach a new receipt to a record nobody can see or edit
        // anymore. But `vatId` is unique per tenant regardless of `isActive`, so if a
        // deactivated customer already holds this VAT ID, reactivate that same row
        // instead of trying to create a second one (which would just fail on the
        // unique constraint) -- transacting with them again is exactly what
        // "reactivate" means.
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
        // Name or VAT ID (or both) missing -- per spec, this is never saved to the
        // Customers table; the receipt falls back to the tenant's walk-in customer
        // and whatever partial info was typed is simply not persisted anywhere.
        // Every tenant is *supposed* to get a Walk-in Customer row at onboarding
        // (seed-tenant.ts), but a receipt save shouldn't hard-fail for a tenant that
        // ended up without one for any reason -- lazily creating it here, after the
        // row lock above, is simpler and more robust than trying to guarantee every
        // tenant-provisioning path seeds it correctly. The row lock already makes
        // this safe under concurrency for the same reason the VAT-ID find-or-create
        // above is: a second save for this tenant blocks at the lock until the
        // first commits, so it will always find the walk-in customer this branch
        // just created rather than racing to create a second one.
        let walkIn = await txn.customer.findFirst({ where: { tenantId, isWalkIn: true } });
        if (!walkIn) {
          walkIn = await txn.customer.create({
            data: { tenantId, name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput,
          });
        }
        customerId = walkIn.id;
      }

      const uuid = preAssigned?.uuid ?? randomUUID();
      const createdAt = new Date();
      const invoiceHash = computeInvoiceHash({
        previousInvoiceHash,
        uuid,
        grandTotal: grandTotal.toFixed(2),
        vatTotal: vatTotal.toFixed(2),
        createdAt: createdAt.toISOString(),
      });

      const tenant = await txn.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const qrCode = buildZatcaQrPayload({
        sellerName: tenant.legalName,
        vatNumber: tenant.vatNumber,
        timestamp: createdAt.toISOString(),
        invoiceTotal: grandTotal.toFixed(2),
        vatTotal: vatTotal.toFixed(2),
      });

      const created = await txn.document.create({
        data: {
          tenantId,
          type: "SALES_RECEIPT",
          number,
          customerId,
          subtotal,
          vatTotal,
          grandTotal,
          notes,
          uuid,
          invoiceHash,
          previousInvoiceHash,
          qrCode,
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

      for (const line of resolvedLines) {
        await applyStockMovement(txn, {
          tenantId,
          productId: line.productId,
          type: "SALE",
          quantityDelta: -line.quantity,
          createdByUserId: userId,
          documentId: created.id,
        });
      }

      await txn.tenant.update({
        where: { id: tenantId },
        data: { lastSalesReceiptHash: invoiceHash },
      });

      return { existing: created, isRetry: false } as const;
    }, { timeout: 15000, maxWait: 5000 });

    const { existing: document, isRetry } = result;
    return NextResponse.json(document, { status: isRetry ? 200 : 201 });
  } catch (err) {
    if (err instanceof ReceiptError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
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
  // Upper-bounded as well as lower-bounded: an absurdly large page number (e.g.
  // a manually edited query string) would otherwise flow straight into
  // `skip = (page - 1) * PAGE_SIZE` below, producing a value outside what
  // Prisma's `skip` can accept and surfacing as a 500 instead of the documented
  // "out-of-range page returns an empty page" behavior.
  const page =
    Number.isFinite(pageParam) && pageParam >= 1 ? Math.min(Math.floor(pageParam), 1_000_000) : 1;

  const search = url.searchParams.get("search")?.trim() || "";
  const startOfDay = parseDateOrNull(url.searchParams.get("dateFrom"));
  const endOfDay = parseDateOrNull(url.searchParams.get("dateTo"));
  if (endOfDay) {
    endOfDay.setUTCHours(23, 59, 59, 999);
  }

  // `tenantId` is deliberately absent from this `where` -- withTenant() injects it
  // on every query it runs, and a caller-supplied value here would just be
  // redundant with (and silently overridden by) that injection. See the
  // Global Constraints note in this plan and tenant-context.ts's own comment.
  const where: Prisma.DocumentWhereInput = {
    type: "SALES_RECEIPT",
  };
  if (startOfDay || endOfDay) {
    where.createdAt = {
      ...(startOfDay ? { gte: startOfDay } : {}),
      ...(endOfDay ? { lte: endOfDay } : {}),
    };
  }
  if (search) {
    const strippedHash = search.startsWith("#") ? search.slice(1) : search;
    // `Document.number` is Postgres INT4 (max 2,147,483,647). A Saudi VAT ID is
    // always 15 digits, so it passes this digit-only regex too -- without the
    // upper-bound check, an out-of-range value gets handed to Prisma as an exact
    // `number` match and Prisma throws ("Unable to fit integer value into an
    // INT4"), surfacing as a 500. Falling through to `null` here instead lets
    // the search fall back to the `contains` (name/vatId) branches below, which
    // is the correct behavior for a VAT ID search anyway.
    const parsed = /^\d+$/.test(strippedHash) ? Number(strippedHash) : null;
    const parsedNumber = parsed !== null && parsed <= 2147483647 ? parsed : null;
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

  const receipts = documents.map((doc) => ({
    id: doc.id,
    number: doc.number,
    customerName: doc.customer.name,
    customerVatId: doc.customer.vatId,
    createdAt: doc.createdAt.toISOString(),
    grandTotal: doc.grandTotal.toString(),
  }));

  return NextResponse.json({ receipts, total, page, pageSize: PAGE_SIZE });
}
