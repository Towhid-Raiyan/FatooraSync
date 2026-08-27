import QRCode from "qrcode";
import { offlineDb, type PendingDocument } from "./db";
import { buildZatcaQrPayload } from "@/lib/zatca/qr-payload";
import { calculateDocumentTotals, type LineTotals } from "@/lib/receipts/calculate-totals";

// The exact fields calculateDocumentTotals() needs (LineTotals), plus what
// the print templates display. Callers (Task 13) build this with the same
// calculateLine() call the online route uses, so offline and online receipts
// total identically for the same inputs.
export interface OfflineResolvedLine extends LineTotals {
  id: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  discount: string;
}

// Mirrors the shape src/app/api/receipts/[id]/print-data/route.ts returns for
// a synced receipt, built entirely from local Dexie data -- this is what lets
// PrintModal (see below) render an offline sale identically to an online one,
// with no server round trip. Quotations skip the QR entirely, matching the
// existing online quotation print path (quotations are never invoiced, so
// they never carried a QR to begin with).
export async function buildOfflinePrintData(kind: "receipt" | "quotation", doc: PendingDocument, resolvedLines: OfflineResolvedLine[]) {
  const [settings, tenant] = await Promise.all([
    offlineDb.settings.get("singleton"),
    offlineDb.tenant.get("singleton"),
  ]);
  if (!settings || !tenant) throw new Error("Offline cache is empty -- open this page online at least once first");

  const { subtotal, vatTotal, grandTotal } = calculateDocumentTotals(resolvedLines);

  let qrImageDataUrl: string | null = null;
  if (kind === "receipt") {
    const qrPayload = buildZatcaQrPayload({
      sellerName: tenant.legalName,
      vatNumber: tenant.vatNumber,
      timestamp: doc.createdAt,
      invoiceTotal: grandTotal.toFixed(2),
      vatTotal: vatTotal.toFixed(2),
    });
    qrImageDataUrl = await QRCode.toDataURL(qrPayload);
  }

  return {
    printFormat: settings.printFormat,
    tenant: {
      tradeNameEn: tenant.tradeNameEn,
      tradeNameAr: tenant.tradeNameAr,
      legalName: tenant.legalName,
      vatNumber: tenant.vatNumber,
      crNumber: tenant.crNumber,
      phone: tenant.phone,
      address: tenant.address,
    },
    document: {
      number: doc.number,
      createdAt: doc.createdAt,
      subtotal: subtotal.toFixed(2),
      vatTotal: vatTotal.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      notes: doc.notes || null,
      customer: {
        name: doc.customer.name || "Walk-in Customer",
        vatId: doc.customer.vatId || null,
        crNumber: doc.customer.crNumber || null,
        phone: doc.customer.phone || null,
        address: doc.customer.address || null,
      },
      lines: resolvedLines.map(({ id, productName, quantity, unitPrice, discount, lineVat, lineTotal }) => ({
        id, productName, quantity, unitPrice, discount,
        lineVat: lineVat.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
      })),
    },
    qrImageDataUrl,
  };
}
