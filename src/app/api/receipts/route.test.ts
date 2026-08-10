import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST } from "./route";

let tenantId: string;
let otherTenantId: string;
let walkInCustomerId: string;
let productId: string;
let productWithVatOverrideId: string;
let otherTenantProductId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/receipts", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/receipts", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Receipts Test Co", tradeNameEn: "Receipts Test Shop", vatNumber: "300000000000105" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });

    const walkIn = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    walkInCustomerId = walkIn.id;

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Rice 5kg", unitPrice: 20, quantity: 5 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productId = product.id;

    const productWithVat = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Exempt Item", unitPrice: 10, vatRate: 0, quantity: 100 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productWithVatOverrideId = productWithVat.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Receipts Co", tradeNameEn: "Other Receipts Shop", vatNumber: "300000000000112" },
    });
    otherTenantId = otherTenant.id;
    await prisma.settings.create({ data: { tenantId: otherTenantId, defaultVatRate: 15 } });
    const otherProduct = await withTenant(otherTenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Other Tenant Product", unitPrice: 1, quantity: 10 } as Prisma.ProductUncheckedCreateInput })
    );
    otherTenantProductId = otherProduct.id;
  });

  afterAll(async () => {
    await prisma.documentLine.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("creates a receipt, decrements stock, and computes totals from the server-read product", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "2" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.number).toBe(1);
    expect(body.subtotal).toBe("40");
    expect(body.vatTotal).toBe("6");
    expect(body.grandTotal).toBe("46");
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].productName).toBe("Rice 5kg");

    const product = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(product.quantity.toString()).toBe("3"); // 5 - 2
  });

  it("uses the product's own VAT override instead of the tenant default", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customerId: walkInCustomerId, lines: [{ productId: productWithVatOverrideId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vatTotal).toBe("0");
  });

  it("ignores a client-supplied price/VAT/name and uses the server's own product read", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customerId: walkInCustomerId,
        lines: [
          {
            productId,
            quantity: "1",
            unitPrice: "999999.99",
            vatRate: "0",
            productName: "Forged Line Item",
          },
        ],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines[0].unitPrice).toBe("20");
    expect(body.lines[0].productName).toBe("Rice 5kg");
    expect(body.grandTotal).toBe("23"); // 20 * 1.15, not the forged total
  });

  it("assigns sequential receipt numbers and chains the hash", { timeout: 30000 }, async () => {
    const first = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "1" }] }));
    const second = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "1" }] }));
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.number).toBe(firstBody.number + 1);
    expect(secondBody.previousInvoiceHash).toBe(firstBody.invoiceHash);
  });

  it("creates a new customer inline when newCustomer is provided instead of customerId", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        newCustomer: { name: "Fresh Customer", phone: "0500000000" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.name).toBe("Fresh Customer");
  });

  it("allows stock to go negative without blocking the save", { timeout: 30000 }, async () => {
    const response = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "999" }] }));
    expect(response.status).toBe(201);
    const product = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(Number(product.quantity)).toBeLessThan(0);
  });

  it("returns 400 for an empty line list", { timeout: 30000 }, async () => {
    const response = await POST(postRequest({ customerId: walkInCustomerId, lines: [] }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-positive quantity", { timeout: 30000 }, async () => {
    const response = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "0" }] }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a productId belonging to another tenant", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customerId: walkInCustomerId, lines: [{ productId: otherTenantProductId, quantity: "1" }] })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a customerId belonging to another tenant", { timeout: 30000 }, async () => {
    const otherCustomer = await withTenant(otherTenantId, (tx) =>
      tx.customer.create({ data: { name: "Other Tenant Customer" } as Prisma.CustomerUncheckedCreateInput })
    );
    const response = await POST(
      postRequest({ customerId: otherCustomer.id, lines: [{ productId, quantity: "1" }] })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when neither customerId nor newCustomer is provided", { timeout: 30000 }, async () => {
    const response = await POST(postRequest({ lines: [{ productId, quantity: "1" }] }));
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "1" }] }));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
