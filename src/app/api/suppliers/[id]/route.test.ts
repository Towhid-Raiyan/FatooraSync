import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { PATCH } from "./route";

let tenantId: string;
let otherTenantId: string;
let supplierId: string;
let otherTenantSupplierId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/suppliers/x", { method: "PATCH", body: JSON.stringify(body) });
}

describe("/api/suppliers/[id]", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Supplier Patch Test Co", tradeNameEn: "Supplier Patch Shop", vatNumber: "300000000000624" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };

    const supplier = await withTenant(tenantId, (tx) =>
      tx.supplier.create({ data: { name: "Editable Supplier", phone: "0500000000" } as Prisma.SupplierUncheckedCreateInput })
    );
    supplierId = supplier.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Supplier Patch Co", tradeNameEn: "Other Supplier Patch Shop", vatNumber: "300000000000631" },
    });
    otherTenantId = otherTenant.id;
    const otherSupplier = await withTenant(otherTenantId, (tx) =>
      tx.supplier.create({ data: { name: "Other Tenant's Supplier" } as Prisma.SupplierUncheckedCreateInput })
    );
    otherTenantSupplierId = otherSupplier.id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.supplier.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("updates name, phone, and address", async () => {
    const response = await PATCH(patchRequest({ name: "Renamed Supplier", phone: "0511111111", address: "Riyadh" }), {
      params: Promise.resolve({ id: supplierId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Renamed Supplier");
    expect(body.phone).toBe("0511111111");
    expect(body.address).toBe("Riyadh");
  });

  it("deactivates a supplier via isActive", async () => {
    const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: supplierId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isActive).toBe(false);

    await PATCH(patchRequest({ isActive: true }), { params: Promise.resolve({ id: supplierId }) });
  });

  it("returns 400 for an empty name", async () => {
    const response = await PATCH(patchRequest({ name: "   " }), { params: Promise.resolve({ id: supplierId }) });
    expect(response.status).toBe(400);
  });

  it("returns 404 for a supplier belonging to another tenant", async () => {
    const response = await PATCH(patchRequest({ name: "Hijacked" }), {
      params: Promise.resolve({ id: otherTenantSupplierId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown supplier id", async () => {
    const response = await PATCH(patchRequest({ name: "Nobody" }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await PATCH(patchRequest({ name: "X" }), { params: Promise.resolve({ id: supplierId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 403 for a Cashier when the Owner has turned off cashierCanManageCatalog", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await PATCH(patchRequest({ name: "Blocked Edit" }), { params: Promise.resolve({ id: supplierId }) });
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });
});
