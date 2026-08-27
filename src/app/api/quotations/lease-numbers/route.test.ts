import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { POST } from "./route";

let tenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function req(deviceId: string | null) {
  const headers = new Headers();
  if (deviceId) headers.set("X-Device-Id", deviceId);
  return new Request("http://localhost/api/quotations/lease-numbers", { method: "POST", headers });
}

describe("/api/quotations/lease-numbers", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Lease Route Co", tradeNameEn: "Lease Route Quotation Shop", vatNumber: "300000000000789" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
  }, 30000);

  afterAll(async () => {
    await prisma.numberLease.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns a leased range for a valid device id", { timeout: 30000 }, async () => {
    const response = await POST(req("device-x"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rangeStart).toBe(1);
    expect(body.rangeEnd).toBe(20);
  });

  it("returns 400 when X-Device-Id is missing", { timeout: 30000 }, async () => {
    const response = await POST(req(null));
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(req("device-x"));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
