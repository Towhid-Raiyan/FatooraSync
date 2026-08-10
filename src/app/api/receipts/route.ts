import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { calculateLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
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

  const parsedLines: { productId: string; quantity: number }[] = [];
  for (const line of rawLines) {
    const quantity = Number(line.quantity);
    if (typeof line.productId !== "string" || !Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Each item must have a positive quantity" }, { status: 400 });
    }
    parsedLines.push({ productId: line.productId, quantity });
  }

  const hasExistingCustomer = typeof body.customerId === "string" && body.customerId.length > 0;
  const newCustomer = body.newCustomer;
  let newCustomerName = "";
  if (!hasExistingCustomer) {
    newCustomerName = typeof newCustomer?.name === "string" ? newCustomer.name.trim() : "";
    if (!newCustomerName) {
      return NextResponse.json({ error: "A customer is required" }, { status: 400 });
    }
  }

  const trimmedNotes = typeof body.notes === "string" ? body.notes.trim() : "";
  const notes = trimmedNotes || null;

  try {
    // This transaction does ~8-10 sequential round trips (settings read, customer
    // resolve, one product read per line, two tenant updates, a tenant read, the
    // document create, and one product update per line). Prisma's default
    // interactive-transaction timeout (5000ms) is tight for that even on a warm
    // connection, and Neon's serverless compute can add multi-second latency to the
    // first query after it's been idle. A longer timeout avoids spurious "Transaction
    // already closed" failures without changing any transactional logic.
    const document = await prisma.$transaction(async (txn) => {
      const settings = await txn.settings.findUniqueOrThrow({ where: { tenantId } });

      let customerId: string;
      if (hasExistingCustomer) {
        const existing = await txn.customer.findFirst({ where: { id: body.customerId, tenantId } });
        if (!existing) throw new ReceiptError("Selected customer not found", 400);
        customerId = existing.id;
      } else {
        const created = await txn.customer.create({
          data: {
            tenantId,
            name: newCustomerName,
            vatId: newCustomer?.vatId || null,
            crNumber: newCustomer?.crNumber || null,
            phone: newCustomer?.phone || null,
            address: newCustomer?.address || null,
          } as Prisma.CustomerUncheckedCreateInput,
        });
        customerId = created.id;
      }

      const resolvedLines: {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
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
          throw new ReceiptError("One or more items are no longer available", 400);
        }
        const unitPrice = Number(product.unitPrice);
        const vatRate = product.vatRate !== null ? Number(product.vatRate) : Number(settings.defaultVatRate);
        const { lineSubtotal, lineVat, lineTotal } = calculateLine({ unitPrice, quantity: line.quantity, vatRate });
        resolvedLines.push({
          productId: product.id,
          productName: product.nameEn,
          quantity: line.quantity,
          unitPrice,
          vatRate,
          lineSubtotal,
          lineVat,
          lineTotal,
        });
      }

      const { subtotal, vatTotal, grandTotal } = calculateDocumentTotals(resolvedLines);

      const tenantCounters = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: 1 } },
        select: { nextSalesReceiptNumber: true, lastSalesReceiptHash: true },
      });
      const number = tenantCounters.nextSalesReceiptNumber - 1;
      const previousInvoiceHash = tenantCounters.lastSalesReceiptHash ?? GENESIS_HASH;

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
