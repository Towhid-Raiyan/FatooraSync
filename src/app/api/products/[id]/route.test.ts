import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { PATCH } from "./route";

let tenantId: string;
let otherTenantId: string;
let productId: string;
let productWithSku: { id: string; sku: string | null };
let otherTenantProductId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/products/x", { method: "PATCH", body: JSON.stringify(body) });
}

describe("/api/products/[id]", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Product Patch Test Co", tradeNameEn: "Product Patch Shop", vatNumber: "300000000000082" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Editable Product", unitPrice: 10 } as Prisma.ProductUncheckedCreateInput })
    );
    productId = product.id;

    // Created with a direct DB write (not through the route) so this test can assert
    // that a PATCH can never move it away from its originally-assigned sku.
    const withSku = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Product With Sku", unitPrice: 5, sku: "SKU-EXIST", barcode: "2222222222" } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productWithSku = { id: withSku.id, sku: withSku.sku };

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Product Patch Co", tradeNameEn: "Other Product Patch Shop", vatNumber: "300000000000099" },
    });
    otherTenantId = otherTenant.id;
    const otherProduct = await withTenant(otherTenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Other Tenant Product", unitPrice: 1 } as Prisma.ProductUncheckedCreateInput })
    );
    otherTenantProductId = otherProduct.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("updates a product's fields", async () => {
    const response = await PATCH(patchRequest({ nameEn: "Renamed Product", unitPrice: "12.5" }), {
      params: Promise.resolve({ id: productId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nameEn).toBe("Renamed Product");
    expect(body.unitPrice).toBe("12.5");
  });

  it("deactivates then reactivates a product", async () => {
    const deactivate = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: productId }) });
    expect(deactivate.status).toBe(200);
    expect((await deactivate.json()).isActive).toBe(false);

    const reactivate = await PATCH(patchRequest({ isActive: true }), { params: Promise.resolve({ id: productId }) });
    expect(reactivate.status).toBe(200);
    expect((await reactivate.json()).isActive).toBe(true);
  });

  it("returns 404 for a nonexistent id", async () => {
    const response = await PATCH(patchRequest({ nameEn: "Nope" }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for a product belonging to another tenant", async () => {
    const response = await PATCH(patchRequest({ nameEn: "Should not work" }), {
      params: Promise.resolve({ id: otherTenantProductId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 400 when clearing the name to empty", async () => {
    const response = await PATCH(patchRequest({ nameEn: "   " }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for a negative unit price", async () => {
    const response = await PATCH(patchRequest({ unitPrice: "-1" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for a negative quantity", async () => {
    const response = await PATCH(patchRequest({ quantity: "-1" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for an out-of-range VAT rate", async () => {
    const response = await PATCH(patchRequest({ vatRate: "200" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(400);
  });

  it("PATCH clears a VAT override back to the tenant default via vatRate: null", async () => {
    const withVat = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Has Vat Override", unitPrice: 10, vatRate: 5 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    const response = await PATCH(patchRequest({ vatRate: null }), { params: Promise.resolve({ id: withVat.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.vatRate).toBeNull();
  });

  it("returns 409 when updating barcode to one already used in the same tenant", async () => {
    const response = await PATCH(patchRequest({ barcode: "2222222222" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("barcode");
  });

  it("ignores a sku field in the request body -- sku is never editable", async () => {
    const response = await PATCH(patchRequest({ sku: "SKU-ATTEMPTED-CHANGE" }), {
      params: Promise.resolve({ id: productWithSku.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sku).toBe(productWithSku.sku);
    expect(body.sku).not.toBe("SKU-ATTEMPTED-CHANGE");
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await PATCH(patchRequest({ nameEn: "Nope" }), { params: Promise.resolve({ id: productId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
