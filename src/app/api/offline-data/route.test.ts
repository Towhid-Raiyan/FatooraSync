import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET } from "./route";

let tenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("/api/offline-data", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Offline Data Co", tradeNameEn: "Offline Data Shop", vatNumber: "300000000000321" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
    await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Offline Product", sku: "SKU-OFF-1", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput })
    );
  }, 30000);

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns products, customers, settings, and tenant info", { timeout: 30000 }, async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.products).toHaveLength(1);
    expect(body.products[0].sku).toBe("SKU-OFF-1");
    expect(typeof body.products[0].unitPrice).toBe("string");
    expect(body.settings.printFormat).toBe("THERMAL");
    expect(body.tenant.tradeNameEn).toBe("Offline Data Shop");
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await GET();
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
