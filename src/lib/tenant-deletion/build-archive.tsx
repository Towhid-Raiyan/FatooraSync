import JSZip from "jszip";
import QRCode from "qrcode";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReceiptPdfA4Document } from "@/lib/receipts/receipt-pdf-a4";
import { QuotationPdfA4Document } from "@/lib/quotations/quotation-pdf-a4";
import type { GatheredTenantData } from "./gather-tenant-data";

// Builds the full export archive as an in-memory zip. Every receipt and
// quotation is rendered through the exact same A4 PDF components the app
// already uses for live downloads (src/app/api/receipts/[id]/pdf/route.tsx),
// so an archived document looks identical to what was actually handed to
// the customer -- a JSON dump alone would not be an acceptable substitute
// for a real invoice if this tenant's records were ever audited.
//
// This file is .tsx (not .ts, despite the task naming it build-archive.ts)
// because it needs real JSX: renderToBuffer's type expects a
// ReactElement<DocumentProps>, and building these elements with
// React.createElement instead of JSX syntax does not satisfy that type
// (FunctionComponentElement<Props> vs ReactElement<DocumentProps> mismatch),
// even though the identical JSX usage in the existing pdf/route.tsx
// type-checks cleanly.
export async function buildTenantArchive(data: GatheredTenantData): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        originalTenantId: data.tenant.id,
        legalName: data.tenant.legalName,
        tradeNameEn: data.tenant.tradeNameEn,
        tradeNameAr: data.tenant.tradeNameAr,
        vatNumber: data.tenant.vatNumber,
        crNumber: data.tenant.crNumber,
        phone: data.tenant.phone,
        address: data.tenant.address,
        joinedAt: data.tenant.createdAt,
        exportedAt: new Date().toISOString(),
        receiptCount: data.summary.receiptCount,
        quotationCount: data.summary.quotationCount,
        creditNoteCount: data.summary.creditNoteCount,
        customerCount: data.customers.length,
        productCount: data.products.length,
        supplierCount: data.suppliers.length,
        purchaseReceiptCount: data.purchaseReceipts.length,
        stockMovementCount: data.stockMovements.length,
        earliestDocumentAt: data.summary.earliestDocumentAt,
        latestDocumentAt: data.summary.latestDocumentAt,
      },
      null,
      2
    )
  );

  zip.file(
    "data.json",
    JSON.stringify(
      {
        tenant: data.tenant,
        settings: data.settings,
        users: data.users,
        customers: data.customers,
        products: data.products,
        suppliers: data.suppliers,
        receipts: data.receipts,
        quotations: data.quotations,
        creditNotes: data.creditNotes,
        purchaseReceipts: data.purchaseReceipts,
        stockMovements: data.stockMovements,
        numberLeases: data.numberLeases,
      },
      null,
      2
    )
  );

  // A4 is the safer default for an archive meant to be opened and read by a
  // human later (auditor, the client themselves) rather than printed on a
  // thermal till -- independent of whatever print format the tenant's own
  // Settings had configured while they were active.
  for (const receipt of data.receipts) {
    const qrImageDataUrl = receipt.qrCode ? await QRCode.toDataURL(receipt.qrCode) : null;
    const buffer = await renderToBuffer(
      <ReceiptPdfA4Document tenant={data.tenant} document={receipt} qrImageDataUrl={qrImageDataUrl} />
    );
    zip.file(`receipts/${receipt.number}.pdf`, buffer);
  }

  for (const quotation of data.quotations) {
    const buffer = await renderToBuffer(<QuotationPdfA4Document tenant={data.tenant} document={quotation} />);
    zip.file(`quotations/${quotation.number}.pdf`, buffer);
  }

  for (const creditNote of data.creditNotes) {
    const qrImageDataUrl = creditNote.qrCode ? await QRCode.toDataURL(creditNote.qrCode) : null;
    const buffer = await renderToBuffer(
      <ReceiptPdfA4Document tenant={data.tenant} document={creditNote} qrImageDataUrl={qrImageDataUrl} />
    );
    zip.file(`credit-notes/${creditNote.number}.pdf`, buffer);
  }

  return zip.generateAsync({ type: "nodebuffer" });
}
