import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { getQuotationPrintData } from "./get-print-data";

let tenantId: string;
let quotationId: string;

describe("getQuotationPrintData", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Quotation Print Data Test Co", tradeNameEn: "Quotation Print Data Shop", vatNumber: "300000000000164" },
    });
    tenantId = tenant.id;
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "Quotation Print Data Customer" } }));
    const quotation = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "QUOTATION",
          number: 1,
          customerId: customer.id,
          subtotal: 20,
          vatTotal: 3,
          grandTotal: 23,
        },
      })
    );
    quotationId = quotation.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns the document, tenant, and printFormat", async () => {
    const result = await getQuotationPrintData(tenantId, quotationId);
    expect(result).not.toBeNull();
    expect(result?.document.id).toBe(quotationId);
    expect(result?.tenant.id).toBe(tenantId);
    expect(result?.printFormat).toBe("THERMAL");
  });

  it("returns null for a nonexistent id", async () => {
    const result = await getQuotationPrintData(tenantId, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("returns null for a document that is a receipt, not a quotation", async () => {
    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "Wrong Type Customer" } }));
    const receipt = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: { tenantId, type: "SALES_RECEIPT", number: 900, customerId: customer.id, subtotal: 1, vatTotal: 0.15, grandTotal: 1.15 },
      })
    );
    const result = await getQuotationPrintData(tenantId, receipt.id);
    expect(result).toBeNull();
  });
});
