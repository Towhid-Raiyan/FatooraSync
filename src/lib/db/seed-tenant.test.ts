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

  it(
    "accepts optional crNumber, phone, and address, and sets a 14-day trial",
    { timeout: 30000 },
    async () => {
      const uniqueId = Date.now();
      const before = Date.now();
      const result = await seedTenant({
        legalName: "Seed Test Co 2",
        tradeNameEn: "Seed Test Shop 2",
        vatNumber: "300000000000006",
        ownerEmail: `seedowner2+${uniqueId}@example.com`,
        ownerPassword: "seedpassword123",
        crNumber: "1010101010",
        phone: "0500000000",
        address: "123 Test Street, Riyadh",
      });

      try {
        expect(result.tenant.crNumber).toBe("1010101010");
        expect(result.tenant.phone).toBe("0500000000");
        expect(result.tenant.address).toBe("123 Test Street, Riyadh");
        expect(result.tenant.trialEndsAt).not.toBeNull();
        const trialEndsAtMs = result.tenant.trialEndsAt!.getTime();
        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
        // Allow a generous window either side of "before + 14 days" to absorb
        // test execution time - the exact millisecond isn't the point, the
        // 14-day offset is.
        expect(trialEndsAtMs).toBeGreaterThan(before + fourteenDaysMs - 60_000);
        expect(trialEndsAtMs).toBeLessThan(before + fourteenDaysMs + 60_000);
      } finally {
        await prisma.customer.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.settings.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.user.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.tenant.delete({ where: { id: result.tenant.id } });
      }
    }
  );
});
