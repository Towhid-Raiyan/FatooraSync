import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET } from "./route";

let tenantId: string;
let quotationId: string;
let receiptId: string;
let otherTenantId: string;
let otherTenantQuotationId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function req(id: string) {
  return GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
}

describe("/api/quotations/[id]/for-receipt", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "For-Receipt Test Co", tradeNameEn: "For-Receipt Test Shop", vatNumber: "300000000000921" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Quoted Product", nameAr: "منتج", sku: "SKU-QR-1", unit: "PIECE", unitPrice: 50, quantity: 30 } as Prisma.ProductUncheckedCreateInput,
      })
    );

    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.create({
        data: { tenantId, name: "For-Receipt Customer", vatId: "300000000000938", crNumber: "CR-1", phone: "0500000001", address: "Addr 1" },
      })
    );

    // Line values deliberately differ from the product's current unitPrice
    // (50) -- proving the response uses what was actually quoted, not the
    // product's live catalog price.
    const quotation = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "QUOTATION",
          number: 7,
          customerId: customer.id,
          subtotal: 44,
          vatTotal: 6.6,
          grandTotal: 50.6,
          lines: {
            create: [
              {
                tenantId,
                productId: product.id,
                productName: product.nameEn,
                quantity: 2,
                unitPrice: 22,
                discount: 0,
                vatRate: 15,
                lineSubtotal: 44,
                lineVat: 6.6,
                lineTotal: 50.6,
              },
            ],
          },
        } as Prisma.DocumentUncheckedCreateInput,
      })
    );
    quotationId = quotation.id;

    const receipt = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "SALES_RECEIPT",
          number: 1,
          customerId: customer.id,
          subtotal: 44,
          vatTotal: 6.6,
          grandTotal: 50.6,
        } as Prisma.DocumentUncheckedCreateInput,
      })
    );
    receiptId = receipt.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other For-Receipt Co", tradeNameEn: "Other For-Receipt Shop", vatNumber: "300000000000945" },
    });
    otherTenantId = otherTenant.id;
    await withTenant(otherTenantId, (tx) => tx.settings.create({ data: { tenantId: otherTenantId } }));
    const otherProduct = await withTenant(otherTenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Other Product", unitPrice: 5, quantity: 1 } as Prisma.ProductUncheckedCreateInput })
    );
    const otherCustomer = await withTenant(otherTenantId, (tx) =>
      tx.customer.create({ data: { tenantId: otherTenantId, name: "Other Customer" } })
    );
    const otherQuotation = await withTenant(otherTenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId: otherTenantId,
          type: "QUOTATION",
          number: 1,
          customerId: otherCustomer.id,
          subtotal: 5,
          vatTotal: 0.75,
          grandTotal: 5.75,
          lines: {
            create: [
              {
                tenantId: otherTenantId,
                productId: otherProduct.id,
                productName: otherProduct.nameEn,
                quantity: 1,
                unitPrice: 5,
                discount: 0,
                vatRate: 15,
                lineSubtotal: 5,
                lineVat: 0.75,
                lineTotal: 5.75,
              },
            ],
          },
        } as Prisma.DocumentUncheckedCreateInput,
      })
    );
    otherTenantQuotationId = otherQuotation.id;
  }, 30000);

  afterAll(async () => {
    await prisma.documentLine.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("returns the quotation's customer and lines, priced as quoted rather than the product's current price", async () => {
    const response = await req(quotationId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.number).toBe(7);
    expect(body.customer).toEqual({
      name: "For-Receipt Customer",
      vatId: "300000000000938",
      crNumber: "CR-1",
      phone: "0500000001",
      address: "Addr 1",
    });
    expect(body.lines).toHaveLength(1);
    const line = body.lines[0];
    expect(line.sku).toBe("SKU-QR-1");
    expect(line.productName).toBe("Quoted Product");
    expect(line.productNameAr).toBe("منتج");
    expect(line.unit).toBe("PIECE");
    expect(line.quantity).toBe("2");
    expect(line.unitPrice).toBe("22"); // quoted price, not the product's current 50
    expect(line.discount).toBe("0");
    expect(line.vatRate).toBe("15");
    expect(line.stockAtAdd).toBe("30");
  });

  it("returns 404 for a nonexistent id", async () => {
    const response = await req("00000000-0000-0000-0000-000000000000");
    expect(response.status).toBe(404);
  });

  it("returns 404 for a document that is a receipt, not a quotation", async () => {
    const response = await req(receiptId);
    expect(response.status).toBe(404);
  });

  it("returns 404 for a quotation belonging to another tenant", async () => {
    const response = await req(otherTenantQuotationId);
    expect(response.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await req(quotationId);
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
