import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { assertCanManageCatalog } from "./require-catalog-access";

let tenantId: string;

describe("assertCanManageCatalog", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Catalog Access Test Co", tradeNameEn: "Catalog Access Shop", vatNumber: "300000000000133" },
    });
    tenantId = tenant.id;
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
  });

  afterAll(async () => {
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("always allows an Owner, without even checking the toggle", async () => {
    expect(await assertCanManageCatalog(tenantId, "OWNER")).toBeNull();
  });

  it("allows a Cashier when the toggle defaults to true", async () => {
    expect(await assertCanManageCatalog(tenantId, "CASHIER")).toBeNull();
  });

  it("blocks a Cashier once the Owner turns the toggle off", async () => {
    await withTenant(tenantId, (tx) => tx.settings.update({ where: { tenantId }, data: { cashierCanManageCatalog: false } }));
    try {
      const response = await assertCanManageCatalog(tenantId, "CASHIER");
      expect(response).not.toBeNull();
      expect(response?.status).toBe(403);
    } finally {
      await withTenant(tenantId, (tx) => tx.settings.update({ where: { tenantId }, data: { cashierCanManageCatalog: true } }));
    }
  });
});
