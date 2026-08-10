import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GENESIS_HASH } from "@/lib/zatca/hash-chain";
import { POST } from "./route";

let tenantId: string;
let otherTenantId: string;
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

    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );

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

  it("falls back to the walk-in customer when the customer draft is empty", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "2" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    // First save against a freshly created tenant in beforeAll -- deterministically number 1.
    expect(body.number).toBe(1);
    expect(body.previousInvoiceHash).toBe(GENESIS_HASH);
    expect(body.subtotal).toBe("40");
    expect(body.vatTotal).toBe("6");
    expect(body.grandTotal).toBe("46");
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].productName).toBe("Rice 5kg");

    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.isWalkIn).toBe(true);

    const product = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(product.quantity.toString()).toBe("3"); // 5 - 2
  });

  it("falls back to the walk-in customer when only the name is provided", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "Partial Only", vatId: "" }, lines: [{ productId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.isWalkIn).toBe(true);

    const named = await withTenant(tenantId, (tx) => tx.customer.findFirst({ where: { name: "Partial Only" } }));
    expect(named).toBeNull();
  });

  it("falls back to the walk-in customer when only the VAT ID is provided", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "399999999900003" }, lines: [{ productId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.isWalkIn).toBe(true);

    const byVatId = await withTenant(tenantId, (tx) =>
      tx.customer.findFirst({ where: { vatId: "399999999900003" } })
    );
    expect(byVatId).toBeNull();
  });

  it("uses the product's own VAT override instead of the tenant default", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId: productWithVatOverrideId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vatTotal).toBe("0");
  });

  it("ignores a client-supplied price/VAT/name and uses the server's own product read", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
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
    const first = await POST(postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] }));
    const second = await POST(postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] }));
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.number).toBe(firstBody.number + 1);
    expect(secondBody.previousInvoiceHash).toBe(firstBody.invoiceHash);
  });

  it("creates a new customer when both name and VAT ID are provided", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "Fresh Customer", vatId: "300000000000200", phone: "0500000000" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.name).toBe("Fresh Customer");
    expect(customer?.vatId).toBe("300000000000200");
  });

  it("reuses an existing customer matched by VAT ID instead of creating a duplicate", { timeout: 30000 }, async () => {
    const first = await POST(
      postRequest({
        customer: { name: "Reused Co", vatId: "300000000000217" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    const firstBody = await first.json();

    // Typed with a different name but the same VAT ID -- the stored record should win.
    const second = await POST(
      postRequest({
        customer: { name: "Typo'd Name", vatId: "300000000000217" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    const secondBody = await second.json();

    expect(secondBody.customerId).toBe(firstBody.customerId);
    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.findUnique({ where: { id: firstBody.customerId } })
    );
    expect(customer?.name).toBe("Reused Co");
  });

  it("never matches a customer with the same VAT ID under a different tenant", { timeout: 30000 }, async () => {
    await withTenant(otherTenantId, (tx) =>
      tx.customer.create({
        data: { name: "Other Tenant's Customer", vatId: "300000000000224" } as Prisma.CustomerUncheckedCreateInput,
      })
    );

    const response = await POST(
      postRequest({
        customer: { name: "Same VAT, This Tenant", vatId: "300000000000224" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.tenantId).toBe(tenantId);
    expect(customer?.name).toBe("Same VAT, This Tenant");
  });

  it("reactivates a deactivated customer matched by VAT ID instead of failing on the unique constraint", { timeout: 30000 }, async () => {
    const deactivated = await withTenant(tenantId, (tx) =>
      tx.customer.create({
        data: {
          name: "Deactivated Co",
          vatId: "300000000000231",
          isActive: false,
        } as Prisma.CustomerUncheckedCreateInput,
      })
    );

    const response = await POST(
      postRequest({
        customer: { name: "Deactivated Co", vatId: "300000000000231" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.customerId).toBe(deactivated.id);

    const reactivated = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: deactivated.id } }));
    expect(reactivated?.isActive).toBe(true);
  });

  it("applies a flat discount before VAT and reflects it in the saved line and totals", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "2", discount: "10" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    // raw subtotal 40, discount 10 -> 30, vat 15% = 4.5, total 34.5
    expect(body.lines[0].discount).toBe("10");
    expect(body.subtotal).toBe("30");
    expect(body.vatTotal).toBe("4.5");
    expect(body.grandTotal).toBe("34.5");
  });

  it("returns 400 when a line's discount exceeds its subtotal", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", discount: "999" }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a negative discount", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", discount: "-5" }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("allows stock to go negative without blocking the save", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "999" }] })
    );
    expect(response.status).toBe(201);
    const product = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(Number(product.quantity)).toBeLessThan(0);
  });

  it("returns 400 for an empty line list", { timeout: 30000 }, async () => {
    const response = await POST(postRequest({ customer: { name: "", vatId: "" }, lines: [] }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-positive quantity", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "0" }] })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a productId belonging to another tenant", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId: otherTenantProductId, quantity: "1" }] })
    );
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(
        postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] })
      );
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
