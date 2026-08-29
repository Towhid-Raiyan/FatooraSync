import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { GET } from "./route";

let ctoId: string;
let developerId: string;
let archiveId: string;
let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

function req() {
  return new Request("http://localhost/api/admin/tenants/archived/x/download");
}

describe("GET /api/admin/tenants/archived/[id]/download", () => {
  beforeAll(async () => {
    const cto = await prisma.agencyStaff.create({ data: { email: `download-cto-${Date.now()}@test.local`, passwordHash: "x", role: "CTO" } });
    ctoId = cto.id;
    const dev = await prisma.agencyStaff.create({ data: { email: `download-dev-${Date.now()}@test.local`, passwordHash: "x", role: "DEVELOPER" } });
    developerId = dev.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    const archive = await prisma.tenantArchive.create({
      data: {
        originalTenantId: "orig-download", legalName: "Download Co", tradeNameEn: "Download Shop", vatNumber: "300000000000978",
        joinedAt: new Date("2025-01-01"), deletedByAgencyStaffId: ctoId, receiptCount: 0, quotationCount: 0,
        archiveUrl: "https://example.com/download-archive.zip",
      },
    });
    archiveId = archive.id;
  }, 30000);

  afterAll(async () => {
    await prisma.tenantArchive.deleteMany({ where: { originalTenantId: "orig-download" } });
    await prisma.agencyStaff.deleteMany({ where: { id: { in: [ctoId, developerId] } } });
    await prisma.$disconnect();
  });

  it("returns 403 for a non-CTO caller, since this route exposes full PII, not just summary fields", { timeout: 30000 }, async () => {
    mockSession = { user: { agencyStaffId: developerId, role: "DEVELOPER" } };
    try {
      const response = await GET(req(), { params: Promise.resolve({ id: archiveId }) });
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await GET(req(), { params: Promise.resolve({ id: archiveId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("returns 404 for an archive that does not exist", { timeout: 30000 }, async () => {
    const response = await GET(req(), { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) });
    expect(response.status).toBe(404);
  });
});
