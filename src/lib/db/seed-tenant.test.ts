import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./client";
import { seedTenant } from "./seed-tenant";

describe("seedTenant", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    "creates a tenant, owner user, default settings, and a walk-in customer",
    { timeout: 30000 },
    async () => {
      const uniqueId = Date.now();
      const result = await seedTenant({
        legalName: "Seed Test Co",
        tradeNameEn: "Seed Test Shop",
        vatNumber: "300000000000005",
        ownerEmail: `seedowner+${uniqueId}@example.com`,
        ownerPassword: "seedpassword123",
      });

      try {
        expect(result.tenant.tradeNameEn).toBe("Seed Test Shop");
        expect(result.user.email).toBe(`seedowner+${uniqueId}@example.com`);
        expect(result.settings.defaultVatRate.toString()).toBe("15");
        expect(result.walkInCustomer.isWalkIn).toBe(true);
        expect(result.walkInCustomer.name).toBe("Walk-in Customer");
      } finally {
        await prisma.customer.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.settings.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.user.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.tenant.delete({ where: { id: result.tenant.id } });
      }
    }
  );
});
