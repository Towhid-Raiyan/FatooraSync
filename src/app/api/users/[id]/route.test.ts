import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { hashPassword } from "@/lib/auth/password";
import { PATCH } from "./route";

let tenantId: string;
let otherTenantId: string;
let cashierId: string;
let ownerId: string;
let otherTenantCashierId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/users/x", { method: "PATCH", body: JSON.stringify(body) });
}

describe("/api/users/[id]", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "User Patch Test Co", tradeNameEn: "User Patch Shop", vatNumber: "300000000000119" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };

    const cashierHash = await hashPassword("x");
    const cashier = await withTenant(tenantId, (tx) =>
      tx.user.create({ data: { email: "patch-cashier@example.com", passwordHash: cashierHash, role: "CASHIER" } as Prisma.UserUncheckedCreateInput })
    );
    cashierId = cashier.id;

    const ownerHash = await hashPassword("x");
    const owner = await withTenant(tenantId, (tx) =>
      tx.user.create({ data: { email: "patch-owner@example.com", passwordHash: ownerHash, role: "OWNER" } as Prisma.UserUncheckedCreateInput })
    );
    ownerId = owner.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other User Patch Co", tradeNameEn: "Other User Patch Shop", vatNumber: "300000000000126" },
    });
    otherTenantId = otherTenant.id;
    const otherHash = await hashPassword("x");
    const otherCashier = await withTenant(otherTenantId, (tx) =>
      tx.user.create({ data: { email: "other-tenant-cashier@example.com", passwordHash: otherHash, role: "CASHIER" } as Prisma.UserUncheckedCreateInput })
    );
    otherTenantCashierId = otherCashier.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("deactivates then reactivates a Cashier", async () => {
    const deactivate = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: cashierId }) });
    expect(deactivate.status).toBe(200);
    expect((await deactivate.json()).isActive).toBe(false);

    const reactivate = await PATCH(patchRequest({ isActive: true }), { params: Promise.resolve({ id: cashierId }) });
    expect(reactivate.status).toBe(200);
    expect((await reactivate.json()).isActive).toBe(true);
  });

  it("returns 403 when targeting an Owner account", async () => {
    const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: ownerId }) });
    expect(response.status).toBe(403);
  });

  it("returns 404 for a user belonging to another tenant", async () => {
    const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: otherTenantCashierId }) });
    expect(response.status).toBe(404);
  });

  it("returns 400 when isActive is not a boolean", async () => {
    const response = await PATCH(patchRequest({ isActive: "false" }), { params: Promise.resolve({ id: cashierId }) });
    expect(response.status).toBe(400);
  });

  it("returns 403 when the caller is a Cashier, not an Owner", async () => {
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: cashierId }) });
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: cashierId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
