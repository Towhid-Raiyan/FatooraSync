import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET, POST } from "./route";

let tenantId: string;
let otherTenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("/api/suppliers", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Suppliers Test Co", tradeNameEn: "Suppliers Test Shop", vatNumber: "300000000000600" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Supplier Co", tradeNameEn: "Other Supplier Shop", vatNumber: "300000000000617" },
    });
    otherTenantId = otherTenant.id;
    await withTenant(otherTenantId, (tx) =>
      tx.supplier.create({ data: { name: "Other Tenant's Supplier" } as Prisma.SupplierUncheckedCreateInput })
    );
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.supplier.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("POST creates a supplier with valid data", async () => {
    const request = new Request("http://localhost/api/suppliers", {
      method: "POST",
      body: JSON.stringify({ name: "Al Waha Foodstuff Trading", phone: "0555555555" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe("Al Waha Foodstuff Trading");
    expect(body.phone).toBe("0555555555");
    expect(body.isActive).toBe(true);
  });

  it("GET returns only this tenant's suppliers, never another tenant's", async () => {
    const response = await GET();
    const body = await response.json();
    const names = body.map((s: { name: string }) => s.name);
    expect(names).toContain("Al Waha Foodstuff Trading");
    expect(names).not.toContain("Other Tenant's Supplier");
  });

  it("POST returns 400 for an empty name", async () => {
    const request = new Request("http://localhost/api/suppliers", {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("GET returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET();
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("POST returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const request = new Request("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({ name: "Should Not Be Created" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("POST returns 403 for a Cashier when the Owner has turned off cashierCanManageCatalog", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({ name: "Cashier Blocked Supplier" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });

  it("POST allows a Cashier when cashierCanManageCatalog is left at its default", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({ name: "Cashier Allowed Supplier" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });
});
