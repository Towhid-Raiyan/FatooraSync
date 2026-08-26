import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST } from "./route";

let tenantId: string;
let otherTenantId: string;
let noBarcodeProductId: string;
let withBarcodeProductId: string;
let vatOverrideProductId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function req(body: unknown) {
  return new Request("http://localhost/api/products/labels/print-data", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/products/labels/print-data", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Label Print Data Co", tradeNameEn: "Label Print Data Shop", vatNumber: "300000000000955" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, defaultVatRate: 15 } }));

    const noBarcode = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "No Barcode Product", sku: "SKU-LBL-1", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    noBarcodeProductId = noBarcode.id;

    const withBarcode = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: {
          nameEn: "Has Barcode Product",
          sku: "SKU-LBL-2",
          barcode: "1234567890123",
          unitPrice: 20,
          quantity: 5,
        } as Prisma.ProductUncheckedCreateInput,
      })
    );
    withBarcodeProductId = withBarcode.id;

    const vatOverride = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Vat Override Product", sku: "SKU-LBL-3", unitPrice: 10, vatRate: 0, quantity: 5 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    vatOverrideProductId = vatOverride.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Label Print Data Co", tradeNameEn: "Other Label Print Data Shop", vatNumber: "300000000000962" },
    });
    otherTenantId = otherTenant.id;
    await withTenant(otherTenantId, (tx) => tx.settings.create({ data: { tenantId: otherTenantId } }));
  }, 30000);

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("auto-generates and persists a barcode (from the SKU) for a product with none", { timeout: 30000 }, async () => {
    const response = await POST(req({ items: [{ productId: noBarcodeProductId, copies: 2 }] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tenantTradeName).toBe("Label Print Data Shop");
    expect(body.items).toHaveLength(1);
    expect(body.items[0].barcodeText).toBe("SKU-LBL-1");
    expect(body.items[0].barcodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.items[0].copies).toBe(2);
    expect(body.items[0].price).toBe("11.50"); // 10 * 1.15, tenant default VAT

    const persisted = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: noBarcodeProductId } }));
    expect(persisted.barcode).toBe("SKU-LBL-1");
  });

  it("uses the existing barcode as-is when the product already has one", { timeout: 30000 }, async () => {
    const response = await POST(req({ items: [{ productId: withBarcodeProductId, copies: 1 }] }));
    const body = await response.json();
    expect(body.items[0].barcodeText).toBe("1234567890123");
    expect(body.items[0].price).toBe("23.00"); // 20 * 1.15
  });

  it("uses the product's own VAT override instead of the tenant default", { timeout: 30000 }, async () => {
    const response = await POST(req({ items: [{ productId: vatOverrideProductId, copies: 1 }] }));
    const body = await response.json();
    expect(body.items[0].price).toBe("10.00"); // 0% override
  });

  it("returns 400 for an empty items array", { timeout: 30000 }, async () => {
    const response = await POST(req({ items: [] }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-positive copies value", { timeout: 30000 }, async () => {
    const response = await POST(req({ items: [{ productId: noBarcodeProductId, copies: 0 }] }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when a product belongs to another tenant", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: otherTenantId, role: "OWNER" } };
    try {
      const response = await POST(req({ items: [{ productId: noBarcodeProductId, copies: 1 }] }));
      expect(response.status).toBe(404);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 403 for a Cashier when the Owner has turned off cashierCanManageCatalog", { timeout: 30000 }, async () => {
    await withTenant(tenantId, (tx) => tx.settings.update({ where: { tenantId }, data: { cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await POST(req({ items: [{ productId: noBarcodeProductId, copies: 1 }] }));
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await withTenant(tenantId, (tx) => tx.settings.update({ where: { tenantId }, data: { cashierCanManageCatalog: true } }));
    }
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(req({ items: [{ productId: noBarcodeProductId, copies: 1 }] }));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
