import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST } from "./route";

let tenantId: string;
let productId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function req(body: unknown) {
  return new Request("http://localhost/api/products/labels/pdf", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/products/labels/pdf", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Label Pdf Route Co", tradeNameEn: "Label Pdf Route Shop", vatNumber: "300000000000979" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Pdf Route Product", sku: "SKU-LBL-PDF-1", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productId = product.id;
  }, 30000);

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns a PDF for a batch of two copies", { timeout: 30000 }, async () => {
    const response = await POST(req({ items: [{ productId, copies: 2 }] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("returns 400 for an empty items array", { timeout: 30000 }, async () => {
    const response = await POST(req({ items: [] }));
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(req({ items: [{ productId, copies: 1 }] }));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
