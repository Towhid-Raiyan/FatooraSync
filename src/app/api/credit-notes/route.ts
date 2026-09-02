import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { calculateCreditNoteLine, calculateDocumentTotals, round3 } from "@/lib/receipts/calculate-totals";
import { computeInvoiceHash, GENESIS_HASH } from "@/lib/zatca/hash-chain";
import { buildZatcaQrPayload } from "@/lib/zatca/qr-payload";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { applyStockMovement } from "@/lib/inventory/apply-stock-movement";

class CreditNoteError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RawCreditLine {
  originalLineId?: unknown;
  quantity?: unknown;
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

  const originalDocumentId = typeof body.originalDocumentId === "string" ? body.originalDocumentId : null;
  if (!originalDocumentId) {
    return NextResponse.json({ error: "originalDocumentId is required" }, { status: 400 });
  }

  const rawLines: RawCreditLine[] = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "Select at least one item to credit" }, { status: 400 });
  }

  const parsedLines: { originalLineId: string; quantity: number }[] = [];
  for (const line of rawLines) {
    const quantity = Number(line.quantity);
    if (typeof line.originalLineId !== "string" || !Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Each credited item must have a positive quantity" }, { status: 400 });
    }
    parsedLines.push({ originalLineId: line.originalLineId, quantity });
  }

  const trimmedNotes = typeof body.notes === "string" ? body.notes.trim() : "";
  const notes = trimmedNotes || null;

  try {
    const created = await prisma.$transaction(async (txn) => {
      const original = await txn.document.findFirst({
        where: { id: originalDocumentId, tenantId, type: "SALES_RECEIPT" },
        include: { lines: true },
      });
      if (!original) {
        throw new CreditNoteError("Receipt not found", 404);
      }

      const originalLinesById = new Map(original.lines.map((line) => [line.id, line]));
      for (const line of parsedLines) {
        if (!originalLinesById.has(line.originalLineId)) {
          throw new CreditNoteError("One or more items do not belong to this receipt", 400);
        }
      }

      // Row-locks this tenant for the rest of the transaction, same idiom as
      // receipts/route.ts's own number-consuming update -- this is what makes
      // the remaining-quantity check below race-safe: two concurrent credit
      // notes against the same receipt can no longer both read the same
      // "already credited" sum and both approve an over-credit, because the
      // second transaction blocks here until the first commits.
      const tenantCounters = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextCreditNoteNumber: { increment: 1 } },
        select: { nextCreditNoteNumber: true, lastInvoiceHash: true },
      });
      const number = tenantCounters.nextCreditNoteNumber - 1;
      const previousInvoiceHash = tenantCounters.lastInvoiceHash ?? GENESIS_HASH;

      const originalLineIds = original.lines.map((line) => line.id);
      const creditedSums = await txn.documentLine.groupBy({
        by: ["creditedForLineId"],
        where: { tenantId, creditedForLineId: { in: originalLineIds } },
        _sum: { quantity: true },
      });
      const creditedByLineId = new Map(
        creditedSums.map((row) => [row.creditedForLineId as string, Number(row._sum.quantity ?? 0)])
      );

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
        creditedForLineId: string;
      }[] = [];

      // Tracks how much of each original line this *request* has already
      // committed to crediting, on top of what the DB-sourced
      // `creditedByLineId` already reflects. Without this, a request that
      // repeats the same originalLineId in multiple entries would have each
      // entry check its quantity against the same DB-only `remaining` in
      // isolation -- e.g. two { originalLineId: "X", quantity: 1 } entries
      // against a line with 1 unit remaining would each individually pass
      // (1 > 1 is false), together over-crediting the line and restoring
      // phantom stock.
      const talliedThisRequest = new Map<string, number>();

      for (const line of parsedLines) {
        const originalLine = originalLinesById.get(line.originalLineId)!;
        const alreadyCredited = creditedByLineId.get(line.originalLineId) ?? 0;
        const alreadyTalliedThisRequest = talliedThisRequest.get(line.originalLineId) ?? 0;
        const originalQuantity = Number(originalLine.quantity);
        const remaining = Math.max(0, round3(originalQuantity - alreadyCredited - alreadyTalliedThisRequest));
        if (line.quantity > remaining) {
          throw new CreditNoteError("Quantity exceeds what's left to credit on this item", 400);
        }
        talliedThisRequest.set(line.originalLineId, alreadyTalliedThisRequest + line.quantity);

        const isFullLineCredit = line.quantity === originalQuantity;
        const { lineSubtotal, lineVat, lineTotal, discount } = isFullLineCredit
          ? {
              lineSubtotal: Number(originalLine.lineSubtotal),
              lineVat: Number(originalLine.lineVat),
              lineTotal: Number(originalLine.lineTotal),
              discount: Number(originalLine.discount),
            }
          : calculateCreditNoteLine({
              unitPrice: Number(originalLine.unitPrice),
              vatRate: Number(originalLine.vatRate),
              originalQuantity,
              originalDiscount: Number(originalLine.discount),
              creditedQuantity: line.quantity,
            });

        resolvedLines.push({
          productId: originalLine.productId,
          productName: originalLine.productName,
          quantity: line.quantity,
          unitPrice: Number(originalLine.unitPrice),
          discount,
          vatRate: Number(originalLine.vatRate),
          lineSubtotal,
          lineVat,
          lineTotal,
          creditedForLineId: originalLine.id,
        });
      }

      const { subtotal, vatTotal, grandTotal } = calculateDocumentTotals(resolvedLines);

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

      const document = await txn.document.create({
        data: {
          tenantId,
          type: "CREDIT_NOTE",
          number,
          customerId: original.customerId,
          creditNoteOfDocumentId: original.id,
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
              creditedForLineId: line.creditedForLineId,
            })),
          },
        } as Prisma.DocumentUncheckedCreateInput,
        include: { lines: true },
      });

      for (const line of resolvedLines) {
        await applyStockMovement(txn, {
          tenantId,
          productId: line.productId,
          type: "RETURN",
          quantityDelta: line.quantity,
          createdByUserId: userId,
          documentId: document.id,
        });
      }

      await txn.tenant.update({
        where: { id: tenantId },
        data: { lastInvoiceHash: invoiceHash },
      });

      return document;
    }, { timeout: 15000, maxWait: 5000 });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof CreditNoteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
