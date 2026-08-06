import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET, PATCH } from "./route";

let tenantId: string;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => ({ user: { tenantId } }),
}));

describe("/api/settings", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Settings Test Co", tradeNameEn: "Settings Test Shop", vatNumber: "300000000000006" },
    });
    tenantId = tenant.id;
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
  });

  afterAll(async () => {
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("GET returns the tenant's settings", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.defaultVatRate).toBe("15");
    expect(body.language).toBe("ar");
  });

  it("PATCH updates the tenant's settings", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "10", language: "en" }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const after = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
    expect(after.defaultVatRate.toString()).toBe("10");
    expect(after.language).toBe("en");
  });
});
