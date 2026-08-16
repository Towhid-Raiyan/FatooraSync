import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { GET, POST } from "./route";

let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

let ctoId: string;
let developerId: string;
const createdTenantIds: string[] = [];

describe("/api/admin/tenants", () => {
  beforeAll(async () => {
    const staffUniqueId = Date.now();
    const cto = await prisma.agencyStaff.create({
      data: { email: `route-test-cto+${staffUniqueId}@fatoorasync.sa`, passwordHash: await hashPassword("x"), role: "CTO" },
    });
    ctoId = cto.id;
    const developer = await prisma.agencyStaff.create({
      data: { email: `route-test-dev+${staffUniqueId}@fatoorasync.sa`, passwordHash: await hashPassword("x"), role: "DEVELOPER" },
    });
    developerId = developer.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyStaffId: { in: [ctoId, developerId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
    await prisma.agencyStaff.deleteMany({ where: { id: { in: [ctoId, developerId] } } });
    await prisma.$disconnect();
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET(new Request("http://localhost/api/admin/tenants"));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("creates a tenant as CTO and writes an audit log entry", async () => {
    const uniqueId = Date.now();
    const response = await POST(
      new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({
          legalName: "Route Test Trading Co",
          tradeNameEn: "Route Test Shop",
          vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
          ownerEmail: `routetest+${uniqueId}@example.com`,
          ownerPassword: "RoutePass123!",
        }),
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.tradeNameEn).toBe("Route Test Shop");
    createdTenantIds.push(body.id);

    const auditRows = await prisma.auditLog.findMany({ where: { tenantId: body.id } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("TENANT_CREATED");
    expect(auditRows[0].agencyStaffId).toBe(ctoId);
  });

  it("returns 403 when a Developer tries to create a tenant", async () => {
    mockSession = { user: { agencyStaffId: developerId, role: "DEVELOPER" } };
    try {
      const response = await POST(
        new Request("http://localhost/api/admin/tenants", {
          method: "POST",
          body: JSON.stringify({
            legalName: "Should Not Exist",
            tradeNameEn: "Should Not Exist Shop",
            vatNumber: "300000000009999",
            ownerEmail: "shouldnotexist@example.com",
            ownerPassword: "RoutePass123!",
          }),
        })
      );
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("returns 400 when required fields are missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({ legalName: "Incomplete Co" }),
      })
    );
    expect(response.status).toBe(400);
  });

  it("lists tenants including the one just created, filtered by search", async () => {
    const response = await GET(new Request("http://localhost/api/admin/tenants?q=Route Test"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tenants.some((t: { tradeNameEn: string }) => t.tradeNameEn === "Route Test Shop")).toBe(true);
  });
});
