import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { GET } from "./route";

let staffId: string;
let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

describe("GET /api/admin/tenants/archived", () => {
  beforeAll(async () => {
    const staff = await prisma.agencyStaff.create({ data: { email: `archived-list-${Date.now()}@test.local`, passwordHash: "x", role: "CTO" } });
    staffId = staff.id;
    mockSession = { user: { agencyStaffId: staffId, role: "CTO" } };
    await prisma.tenantArchive.create({
      data: {
        originalTenantId: "orig-1", legalName: "Archived Co", tradeNameEn: "Archived Shop", vatNumber: "300000000000756",
        joinedAt: new Date("2025-01-01"), deletedByAgencyStaffId: staffId, receiptCount: 3, quotationCount: 1,
        archiveUrl: "https://example.com/archive.zip",
      },
    });
  }, 30000);

  afterAll(async () => {
    await prisma.tenantArchive.deleteMany({ where: { deletedByAgencyStaffId: staffId } });
    await prisma.agencyStaff.delete({ where: { id: staffId } });
    await prisma.$disconnect();
  });

  it("lists archived tenants for an authenticated staff member", { timeout: 30000 }, async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.archives.some((a: { tradeNameEn: string }) => a.tradeNameEn === "Archived Shop")).toBe(true);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await GET();
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: staffId, role: "CTO" } };
    }
  });
});
