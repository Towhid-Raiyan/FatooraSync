import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { PATCH, DELETE } from "./route";

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

function deleteRequest() {
  return new Request("http://localhost/api/users/x", { method: "DELETE" });
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

  it("resets a Cashier's password", async () => {
    const hash = await hashPassword("original-pw");
    const cashier = await withTenant(tenantId, (tx) =>
      tx.user.create({ data: { email: "reset-target@example.com", passwordHash: hash, role: "CASHIER" } as Prisma.UserUncheckedCreateInput })
    );
    const response = await PATCH(patchRequest({ password: "abcd" }), { params: Promise.resolve({ id: cashier.id }) });
    expect(response.status).toBe(200);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: cashier.id } });
    expect(await verifyPassword("abcd", stored.passwordHash)).toBe(true);
  });

  it("returns 400 for a reset password shorter than 4 characters", async () => {
    const response = await PATCH(patchRequest({ password: "abc" }), { params: Promise.resolve({ id: cashierId }) });
    expect(response.status).toBe(400);
  });

  it("updates a Cashier's username to a free-form (non-email) value", async () => {
    const hash = await hashPassword("x");
    const cashier = await withTenant(tenantId, (tx) =>
      tx.user.create({ data: { email: "rename-target@example.com", passwordHash: hash, role: "CASHIER" } as Prisma.UserUncheckedCreateInput })
    );
    const response = await PATCH(patchRequest({ email: "frontdesk" }), { params: Promise.resolve({ id: cashier.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).email).toBe("frontdesk");
  });

  it("returns 400 when the PATCH body has none of isActive, email, or password", async () => {
    const response = await PATCH(patchRequest({}), { params: Promise.resolve({ id: cashierId }) });
    expect(response.status).toBe(400);
  });

  it("permanently deletes a Cashier account", async () => {
    const hash = await hashPassword("x");
    const cashier = await withTenant(tenantId, (tx) =>
      tx.user.create({ data: { email: "delete-target@example.com", passwordHash: hash, role: "CASHIER" } as Prisma.UserUncheckedCreateInput })
    );
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: cashier.id }) });
    expect(response.status).toBe(204);
    const stillThere = await prisma.user.findUnique({ where: { id: cashier.id } });
    expect(stillThere).toBeNull();
  });

  it("returns 403 when deleting an Owner account", async () => {
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: ownerId }) });
    expect(response.status).toBe(403);
  });

  it("returns 404 when deleting a user belonging to another tenant", async () => {
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: otherTenantCashierId }) });
    expect(response.status).toBe(404);
  });

  it("returns 403 when the caller is a Cashier, not an Owner, deleting", async () => {
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: cashierId }) });
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 401 when unauthenticated, deleting", async () => {
    mockSession = null;
    try {
      const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: cashierId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
