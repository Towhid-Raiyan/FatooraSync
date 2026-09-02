import { withTenant } from "@/lib/db/tenant-context";

export interface VatSummary {
  outgoingVat: string;
  incomingVat: string;
  netPayable: string;
}

// Outgoing VAT is what the tenant owes on sales -- a credit note reverses part
// of a sale, so its VAT must be subtracted from the same quarter's receipt VAT,
// not left out entirely. Both queries are scoped to the same [start, end]
// window a credit note issued in the quarter it credits (the normal case)
// nets out correctly here; one issued in a later quarter reduces that later
// quarter's outgoing VAT instead, which matches when the reversal actually
// happened for VAT-return purposes.
export async function getVatSummary(tenantId: string, start: Date, end: Date): Promise<VatSummary> {
  const [receipts, creditNotes, purchases] = await withTenant(tenantId, (txn) =>
    Promise.all([
      txn.document.aggregate({
        where: { type: "SALES_RECEIPT", createdAt: { gte: start, lte: end } },
        _sum: { vatTotal: true },
      }),
      txn.document.aggregate({
        where: { type: "CREDIT_NOTE", createdAt: { gte: start, lte: end } },
        _sum: { vatTotal: true },
      }),
      txn.purchaseReceipt.aggregate({
        where: { purchaseDate: { gte: start, lte: end } },
        _sum: { vatTotal: true },
      }),
    ])
  );

  const receiptVat = Number(receipts._sum.vatTotal ?? 0);
  const creditNoteVat = Number(creditNotes._sum.vatTotal ?? 0);
  const outgoingVat = (receiptVat - creditNoteVat).toFixed(2);
  const incomingVat = (purchases._sum.vatTotal ?? 0).toString();
  const netPayable = (Number(outgoingVat) - Number(incomingVat)).toFixed(2);

  return { outgoingVat, incomingVat, netPayable };
}
