import { withTenant } from "@/lib/db/tenant-context";

export interface CreditableLine {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
  creditedQuantity: number;
  remainingQuantity: number;
}

export interface CreditableLinesResult {
  documentId: string;
  documentNumber: number;
  lines: CreditableLine[];
}

// Remaining-creditable quantity is always computed here, never stored on the
// original line -- DocumentLine rows are immutable once written (see the
// Global Constraints in this plan), so "how much of this line is left to
// credit" is a derived value, summed fresh from whatever credit-note lines
// already point at it via creditedForLineId.
export async function getCreditableLines(tenantId: string, documentId: string): Promise<CreditableLinesResult | null> {
  return withTenant(tenantId, async (tx) => {
    const document = await tx.document.findFirst({
      where: { id: documentId, type: "SALES_RECEIPT" },
      include: { lines: true },
    });
    if (!document) return null;

    const lineIds = document.lines.map((line) => line.id);
    const creditedSums =
      lineIds.length > 0
        ? await tx.documentLine.groupBy({
            by: ["creditedForLineId"],
            where: { creditedForLineId: { in: lineIds } },
            _sum: { quantity: true },
          })
        : [];
    const creditedByLineId = new Map(
      creditedSums.map((row) => [row.creditedForLineId as string, Number(row._sum.quantity ?? 0)])
    );

    return {
      documentId: document.id,
      documentNumber: document.number,
      lines: document.lines.map((line) => {
        const quantity = Number(line.quantity);
        const creditedQuantity = creditedByLineId.get(line.id) ?? 0;
        return {
          id: line.id,
          productName: line.productName,
          quantity,
          unitPrice: Number(line.unitPrice),
          discount: Number(line.discount),
          vatRate: Number(line.vatRate),
          creditedQuantity,
          remainingQuantity: quantity - creditedQuantity,
        };
      }),
    };
  });
}
