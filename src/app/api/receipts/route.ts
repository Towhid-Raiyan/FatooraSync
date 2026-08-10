import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { round2, calculateLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import { computeInvoiceHash, GENESIS_HASH } from "@/lib/zatca/hash-chain";
import { buildZatcaQrPayload } from "@/lib/zatca/qr-payload";

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
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const body = await request.json();

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
    // instead of always re-reading the catalog price. `undefined`/`""` means "use
    // the catalog price" -- that is NOT the same as a `0` override, which is a
    // valid (if unusual) free-item price.
    const unitPriceOverride =
      line.unitPrice === undefined || line.unitPrice === "" ? null : round2(Number(line.unitPrice));
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
    const document = await prisma.$transaction(async (txn) => {
      const settings = await txn.settings.findUniqueOrThrow({ where: { tenantId } });

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
      const tenantCounters = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: 1 } },
        select: { nextSalesReceiptNumber: true, lastSalesReceiptHash: true },
      });
      const number = tenantCounters.nextSalesReceiptNumber - 1;
      const previousInvoiceHash = tenantCounters.lastSalesReceiptHash ?? GENESIS_HASH;

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
        const walkIn = await txn.customer.findFirst({ where: { tenantId, isWalkIn: true } });
        if (!walkIn) {
          throw new ReceiptError("No walk-in customer configured for this tenant", 400);
        }
        customerId = walkIn.id;
      }

      const uuid = randomUUID();
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
        await txn.product.update({
          where: { id: line.productId },
          data: { quantity: { decrement: line.quantity } },
        });
      }

      await txn.tenant.update({
        where: { id: tenantId },
        data: { lastSalesReceiptHash: invoiceHash },
      });

      return created;
    }, { timeout: 15000 });

    return NextResponse.json(document, { status: 201 });
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
