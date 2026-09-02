import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { getDocumentPrintData } from "./get-print-data";

let tenantId: string;
let receiptId: string;

describe("getDocumentPrintData", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Print Data Test Co", tradeNameEn: "Print Data Shop", vatNumber: "300000000000140" },
    });
    tenantId = tenant.id;
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "Print Data Customer" } }));
    const receipt = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "SALES_RECEIPT",
          number: 1,
          customerId: customer.id,
          subtotal: 10,
          vatTotal: 1.5,
          grandTotal: 11.5,
          qrCode: "test-qr-payload",
        },
      })
    );
    receiptId = receipt.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns the document, tenant, printFormat, and a generated QR image", async () => {
    const result = await getDocumentPrintData(tenantId, receiptId, "SALES_RECEIPT");
    expect(result).not.toBeNull();
    expect(result?.document.id).toBe(receiptId);
    expect(result?.tenant.id).toBe(tenantId);
    expect(result?.printFormat).toBe("THERMAL");
    expect(result?.qrImageDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("returns null for a nonexistent id", async () => {
    const result = await getDocumentPrintData(tenantId, "00000000-0000-0000-0000-000000000000", "SALES_RECEIPT");
    expect(result).toBeNull();
  });

  it("returns null when the id belongs to a different tenant", async () => {
    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Print Data Co", tradeNameEn: "Other Print Data Shop", vatNumber: "300000000000157" },
    });
    // getDocumentPrintData looks up Settings for the requesting tenant (to pick
    // the print format), so every tenant it queries against needs a Settings
    // row -- same as in production, where onboarding always creates one
    // alongside the tenant.
    await withTenant(otherTenant.id, (tx) => tx.settings.create({ data: { tenantId: otherTenant.id } }));
    try {
      const result = await getDocumentPrintData(otherTenant.id, receiptId, "SALES_RECEIPT");
      expect(result).toBeNull();
    } finally {
      await prisma.settings.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.tenant.delete({ where: { id: otherTenant.id } });
    }
  });

  it("returns null qrImageDataUrl when the document has no qrCode", async () => {
    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "No QR Customer" } }));
    const receiptWithoutQr = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "SALES_RECEIPT",
          number: 2,
          customerId: customer.id,
          subtotal: 5,
          vatTotal: 0.75,
          grandTotal: 5.75,
        },
      })
    );
    const result = await getDocumentPrintData(tenantId, receiptWithoutQr.id, "SALES_RECEIPT");
    expect(result?.qrImageDataUrl).toBeNull();
  });

  it("returns null when a SALES_RECEIPT id is looked up as a CREDIT_NOTE", async () => {
    const result = await getDocumentPrintData(tenantId, receiptId, "CREDIT_NOTE");
    expect(result).toBeNull();
  });
});
