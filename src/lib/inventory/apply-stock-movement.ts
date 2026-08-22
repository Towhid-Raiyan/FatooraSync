import type { Prisma, StockMovementType, StockAdjustmentReason } from "@prisma/client";

export interface ApplyStockMovementInput {
  tenantId: string;
  productId: string;
  type: StockMovementType;
  quantityDelta: number; // signed: positive grows stock, negative shrinks it
  createdByUserId: string;
  reason?: StockAdjustmentReason;
  note?: string | null;
  unitCost?: number | null;
  supplierId?: string | null;
  documentId?: string | null;
}

// The only code path allowed to change Product.quantity. Updates the product
// and writes the matching StockMovement ledger row in the same transaction,
// so the two can never drift apart -- callers pass in whatever open
// transaction client they're already using (e.g. receipt save's own
// prisma.$transaction), never a plain PrismaClient, so this always
// participates in the caller's atomicity rather than creating its own.
export async function applyStockMovement(txn: Prisma.TransactionClient, input: ApplyStockMovementInput) {
  const product = await txn.product.update({
    where: { id: input.productId, tenantId: input.tenantId },
    data: { quantity: { increment: input.quantityDelta } },
  });

  const movement = await txn.stockMovement.create({
    data: {
      tenantId: input.tenantId,
      productId: input.productId,
      type: input.type,
      quantityDelta: input.quantityDelta,
      quantityAfter: product.quantity,
      reason: input.reason ?? null,
      note: input.note ?? null,
      unitCost: input.unitCost ?? null,
      supplierId: input.supplierId ?? null,
      documentId: input.documentId ?? null,
      createdByUserId: input.createdByUserId,
    },
  });

  return { product, movement };
}
