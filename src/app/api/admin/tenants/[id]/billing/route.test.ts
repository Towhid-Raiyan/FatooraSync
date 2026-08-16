import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { seedTenant } from "@/lib/db/seed-tenant";
import { PATCH } from "./route";

let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

let ctoId: string;
let developerId: string;
let tenantId: string;

describe("/api/admin/tenants/[id]/billing", () => {
  beforeAll(async () => {
    const cto = await prisma.agencyStaff.create({
      data: { email: "billing-route-cto@fatoorasync.sa", passwordHash: await hashPassword("x"), role: "CTO" },
    });
    ctoId = cto.id;
    const developer = await prisma.agencyStaff.create({
      data: { email: "billing-route-dev@fatoorasync.sa", passwordHash: await hashPassword("x"), role: "DEVELOPER" },
    });
    developerId = developer.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };

    const uniqueId = Date.now();
    const result = await seedTenant({
      legalName: "Billing Route Test Co",
      tradeNameEn: "Billing Route Shop",
      vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
      ownerEmail: `billingroute+${uniqueId}@example.com`,
      ownerPassword: "BillingPass123!",
    });
    tenantId = result.tenant.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyStaffId: { in: [ctoId, developerId] } } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.agencyStaff.deleteMany({ where: { id: { in: [ctoId, developerId] } } });
    await prisma.$disconnect();
  });

  it("returns 403 when a Developer tries to change billing status", async () => {
    mockSession = { user: { agencyStaffId: developerId, role: "DEVELOPER" } };
    try {
      const response = await PATCH(
        new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ billingStatus: "ACTIVE" }) }),
        { params: Promise.resolve({ id: tenantId }) }
      );
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("rejects an invalid billingStatus value", async () => {
    const response = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ billingStatus: "NOT_A_STATUS" }) }),
      { params: Promise.resolve({ id: tenantId }) }
    );
    expect(response.status).toBe(400);
  });

  it("updates billing status and writes an audit log entry with from/to", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ billingStatus: "ACTIVE", trialEndsAt: null, featureFlags: { earlyAccess: true } }),
      }),
      { params: Promise.resolve({ id: tenantId }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.billingStatus).toBe("ACTIVE");
    expect(body.featureFlags).toEqual({ earlyAccess: true });

    const auditRows = await prisma.auditLog.findMany({ where: { tenantId, action: "BILLING_STATUS_CHANGED" } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata).toMatchObject({ from: "TRIALING", to: "ACTIVE" });
  });

  it("returns 404 for an unknown tenant id", async () => {
    const response = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ billingStatus: "ACTIVE" }) }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(response.status).toBe(404);
  });
});
