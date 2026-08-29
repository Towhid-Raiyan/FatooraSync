import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { GatheredTenantData } from "./gather-tenant-data";
import { buildTenantArchive } from "./build-archive";

function sampleData(): GatheredTenantData {
  const tenant = {
    id: "tenant-1", legalName: "Archive Test Co", tradeNameEn: "Archive Test Shop", tradeNameAr: null,
    vatNumber: "300000000000725", crNumber: null, address: null, phone: null, defaultLocale: "en",
    createdAt: new Date("2026-01-01"), nextProductSkuNumber: 1, nextSalesReceiptNumber: 2, nextQuotationNumber: 1,
    nextPurchaseReceiptNumber: 1, lastSalesReceiptHash: null, billingStatus: "ACTIVE", trialEndsAt: null, featureFlags: {},
  } as GatheredTenantData["tenant"];

  const customer = {
    id: "cust-1", tenantId: "tenant-1", name: "Walk-in Customer", vatId: null, address: null, phone: null,
    crNumber: null, isWalkIn: true, isActive: true, createdAt: new Date("2026-01-01"),
  } as GatheredTenantData["customers"][number];

  const receiptLine = {
    id: "line-1", tenantId: "tenant-1", documentId: "doc-1", productId: "prod-1", productName: "Test Product",
    quantity: 1 as unknown as number, unitPrice: 10 as unknown as number, discount: 0 as unknown as number,
    vatRate: 15 as unknown as number, lineSubtotal: 10 as unknown as number, lineVat: 1.5 as unknown as number,
    lineTotal: 11.5 as unknown as number,
  };

  const receipt = {
    id: "doc-1", tenantId: "tenant-1", type: "SALES_RECEIPT", number: 1, customerId: "cust-1", customer,
    subtotal: 10 as unknown as number, vatTotal: 1.5 as unknown as number, grandTotal: 11.5 as unknown as number,
    notes: null, creditNoteOfDocumentId: null, uuid: "uuid-1", invoiceHash: null, previousInvoiceHash: null,
    qrCode: null, createdAt: new Date("2026-01-02"), lines: [receiptLine],
  } as unknown as GatheredTenantData["receipts"][number];

  const quotationLine = {
    id: "line-2", tenantId: "tenant-1", documentId: "doc-2", productId: "prod-1", productName: "Test Product",
    quantity: 2 as unknown as number, unitPrice: 20 as unknown as number, discount: 0 as unknown as number,
    vatRate: 15 as unknown as number, lineSubtotal: 40 as unknown as number, lineVat: 6 as unknown as number,
    lineTotal: 46 as unknown as number,
  };

  const quotation = {
    id: "doc-2", tenantId: "tenant-1", type: "QUOTATION", number: 1, customerId: "cust-1", customer,
    subtotal: 40 as unknown as number, vatTotal: 6 as unknown as number, grandTotal: 46 as unknown as number,
    notes: null, creditNoteOfDocumentId: null, uuid: "uuid-2", invoiceHash: null, previousInvoiceHash: null,
    qrCode: null, createdAt: new Date("2026-01-03"), lines: [quotationLine],
  } as unknown as GatheredTenantData["quotations"][number];

  return {
    tenant, customers: [customer], products: [], suppliers: [], receipts: [receipt], quotations: [quotation],
    purchaseReceipts: [], stockMovements: [],
    summary: { receiptCount: 1, quotationCount: 1, earliestDocumentAt: receipt.createdAt, latestDocumentAt: quotation.createdAt },
  };
}

describe("buildTenantArchive", () => {
  it("produces a zip with manifest.json, data.json, and one PDF per receipt", { timeout: 30000 }, async () => {
    const buffer = await buildTenantArchive(sampleData());
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.file("manifest.json")).not.toBeNull();
    expect(zip.file("data.json")).not.toBeNull();
    expect(zip.file("receipts/1.pdf")).not.toBeNull();

    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.tradeNameEn).toBe("Archive Test Shop");
    expect(manifest.receiptCount).toBe(1);

    const data = JSON.parse(await zip.file("data.json")!.async("string"));
    expect(data.customers).toHaveLength(1);

    const pdfBytes = await zip.file("receipts/1.pdf")!.async("uint8array");
    expect(pdfBytes.length).toBeGreaterThan(0);
  });

  it("produces a zip with no receipts/ or quotations/ folder entries when there are none", { timeout: 30000 }, async () => {
    const data = sampleData();
    data.receipts = [];
    data.quotations = [];
    data.summary.receiptCount = 0;
    data.summary.quotationCount = 0;
    const buffer = await buildTenantArchive(data);
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("receipts/1.pdf")).toBeNull();
    expect(zip.file("quotations/1.pdf")).toBeNull();
    expect(zip.file("manifest.json")).not.toBeNull();
  });

  it("renders one PDF per quotation via QuotationPdfA4Document", { timeout: 30000 }, async () => {
    const buffer = await buildTenantArchive(sampleData());
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.file("quotations/1.pdf")).not.toBeNull();

    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.quotationCount).toBe(1);

    const pdfBytes = await zip.file("quotations/1.pdf")!.async("uint8array");
    expect(pdfBytes.length).toBeGreaterThan(0);
  });
});
