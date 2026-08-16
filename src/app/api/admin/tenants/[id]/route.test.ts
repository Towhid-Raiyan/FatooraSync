import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { seedTenant } from "@/lib/db/seed-tenant";
import { GET } from "./route";

let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

let ctoId: string;
let tenantId: string;

describe("/api/admin/tenants/[id]", () => {
  beforeAll(async () => {
    const cto = await prisma.agencyStaff.create({
      data: { email: "detail-route-cto@fatoorasync.sa", passwordHash: await hashPassword("x"), role: "CTO" },
    });
    ctoId = cto.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };

    const uniqueId = Date.now();
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
});
