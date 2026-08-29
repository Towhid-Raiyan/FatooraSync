import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { GET } from "./route";

let staffId: string;
let archiveId: string;
let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

function req() {
  return new Request("http://localhost/api/admin/tenants/archived/x");
}

describe("GET /api/admin/tenants/archived/[id]", () => {
  beforeAll(async () => {
    const staff = await prisma.agencyStaff.create({ data: { email: `archived-detail-${Date.now()}@test.local`, passwordHash: "x", role: "CTO" } });
    staffId = staff.id;
    mockSession = { user: { agencyStaffId: staffId, role: "CTO" } };
    const archive = await prisma.tenantArchive.create({
      data: {
        originalTenantId: "orig-2", legalName: "Detail Co", tradeNameEn: "Detail Shop", vatNumber: "300000000000763",
        joinedAt: new Date("2025-01-01"), deletedByAgencyStaffId: staffId, receiptCount: 0, quotationCount: 0,
        archiveUrl: "https://example.com/detail-archive.zip",
      },
    });
    archiveId = archive.id;
  }, 30000);

  afterAll(async () => {
    await prisma.tenantArchive.deleteMany({ where: { deletedByAgencyStaffId: staffId } });
    await prisma.agencyStaff.delete({ where: { id: staffId } });
    await prisma.$disconnect();
  });

  it("returns one tombstone's full detail", { timeout: 30000 }, async () => {
    const response = await GET(req(), { params: Promise.resolve({ id: archiveId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tradeNameEn).toBe("Detail Shop");
    expect(body.archiveUrl).toBeUndefined();
  });

  it("returns 404 for an archive that does not exist", { timeout: 30000 }, async () => {
    const response = await GET(req(), { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) });
    expect(response.status).toBe(404);
  });
});
