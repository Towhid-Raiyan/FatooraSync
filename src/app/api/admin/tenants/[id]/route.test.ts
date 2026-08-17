import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { seedTenant } from "@/lib/db/seed-tenant";
import { GET, PATCH } from "./route";

let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

let ctoId: string;
let tenantId: string;

describe("/api/admin/tenants/[id]", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const cto = await prisma.agencyStaff.create({
      data: { email: `detail-route-cto+${uniqueId}@fatoorasync.sa`, passwordHash: await hashPassword("x"), role: "CTO" },
    });
    ctoId = cto.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };

    const result = await seedTenant({
      legalName: "Detail Route Test Co",
      tradeNameEn: "Detail Route Shop",
      vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
      ownerEmail: `detailroute+${uniqueId}@example.com`,
      ownerPassword: "DetailPass123!",
    });
    tenantId = result.tenant.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId }, { agencyStaffId: ctoId }] } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.agencyStaff.deleteMany({ where: { id: ctoId } });
    await prisma.$disconnect();
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: tenantId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("returns the tenant's detail", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: tenantId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tradeNameEn).toBe("Detail Route Shop");
    expect(body.billingStatus).toBe("TRIALING");
    expect(body.ownerEmail).toContain("detailroute+");
  });

  it("returns 404 for an unknown tenant id", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });

  it("PATCH updates business info and reflects back on GET", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          legalName: "Detail Route Test Co (Updated)",
          tradeNameEn: "Detail Route Shop",
          tradeNameAr: "متجر محدث",
          vatNumber: "300000000009999",
          crNumber: "CR-999",
          phone: "0555555555",
          address: "Riyadh, Saudi Arabia",
          ownerEmail: (await prisma.user.findFirstOrThrow({ where: { tenantId } })).email,
        }),
      }),
      { params: Promise.resolve({ id: tenantId }) }
    );
    expect(response.status).toBe(200);

    const updated = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: tenantId }) });
    const body = await updated.json();
    expect(body.legalName).toBe("Detail Route Test Co (Updated)");
    expect(body.tradeNameAr).toBe("متجر محدث");
    expect(body.crNumber).toBe("CR-999");
    expect(body.phone).toBe("0555555555");
    expect(body.address).toBe("Riyadh, Saudi Arabia");
  });

  it("PATCH changes the owner's email and password when provided", async () => {
    const uniqueId = Date.now();
    const newEmail = `detail-route-owner-updated+${uniqueId}@example.com`;
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          legalName: "Detail Route Test Co (Updated)",
          tradeNameEn: "Detail Route Shop",
          vatNumber: "300000000009999",
          ownerEmail: newEmail,
          ownerPassword: "NewOwnerPass123!",
        }),
      }),
      { params: Promise.resolve({ id: tenantId }) }
    );
    expect(response.status).toBe(200);

    const owner = await prisma.user.findFirstOrThrow({ where: { tenantId } });
    expect(owner.email).toBe(newEmail);
    expect(await verifyPassword("NewOwnerPass123!", owner.passwordHash)).toBe(true);

    const auditRows = await prisma.auditLog.findMany({ where: { tenantId, action: "TENANT_UPDATED" } });
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[auditRows.length - 1].metadata).toMatchObject({ ownerEmailChanged: true, ownerPasswordChanged: true });
  });

  it("PATCH returns 403 for a Developer (CTO-only)", async () => {
    mockSession = { user: { agencyStaffId: ctoId, role: "DEVELOPER" } };
    try {
      const response = await PATCH(
        new Request("http://localhost", {
          method: "PATCH",
          body: JSON.stringify({ legalName: "x", tradeNameEn: "x", vatNumber: "x", ownerEmail: "x@example.com" }),
        }),
        { params: Promise.resolve({ id: tenantId }) }
      );
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("PATCH returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await PATCH(
        new Request("http://localhost", {
          method: "PATCH",
          body: JSON.stringify({ legalName: "x", tradeNameEn: "x", vatNumber: "x", ownerEmail: "x@example.com" }),
        }),
        { params: Promise.resolve({ id: tenantId }) }
      );
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("PATCH returns 400 when a required field is missing", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ tradeNameEn: "x", vatNumber: "x", ownerEmail: "x@example.com" }),
      }),
      { params: Promise.resolve({ id: tenantId }) }
    );
    expect(response.status).toBe(400);
  });

  it("PATCH returns 404 for an unknown tenant id", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ legalName: "x", tradeNameEn: "x", vatNumber: "x", ownerEmail: "x@example.com" }),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(response.status).toBe(404);
  });
});
