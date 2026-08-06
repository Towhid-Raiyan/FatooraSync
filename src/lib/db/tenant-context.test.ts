import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./client";
import { withTenant } from "./tenant-context";

let tenantAId: string;
let tenantBId: string;

describe("tenant isolation", () => {
  beforeAll(async () => {
    const tenantA = await prisma.tenant.create({
      data: { legalName: "Tenant A", tradeNameEn: "Shop A", vatNumber: "300000000000001" },
    });
    const tenantB = await prisma.tenant.create({
      data: { legalName: "Tenant B", tradeNameEn: "Shop B", vatNumber: "300000000000002" },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    await withTenant(tenantAId, (tx) =>
      tx.customer.create({ data: { tenantId: tenantAId, name: "Customer of A" } })
    );
    await withTenant(tenantBId, (tx) =>
      tx.customer.create({ data: { tenantId: tenantBId, name: "Customer of B" } })
    );
  });

  afterAll(async () => {
    await withTenant(tenantAId, (tx) => tx.customer.deleteMany({ where: { tenantId: tenantAId } }));
    await withTenant(tenantBId, (tx) => tx.customer.deleteMany({ where: { tenantId: tenantBId } }));
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    await prisma.$disconnect();
  });

  it("only returns the active tenant's rows, with no explicit where filter", async () => {
    const customersSeenByA = await withTenant(tenantAId, (tx) => tx.customer.findMany());
    expect(customersSeenByA).toHaveLength(1);
    expect(customersSeenByA[0].name).toBe("Customer of A");

    const customersSeenByB = await withTenant(tenantBId, (tx) => tx.customer.findMany());
    expect(customersSeenByB).toHaveLength(1);
    expect(customersSeenByB[0].name).toBe("Customer of B");
  });

  it("overrides a caller-supplied tenantId in the where clause rather than merging with it", async () => {
    const result = await withTenant(tenantAId, (tx) =>
      tx.customer.findMany({ where: { tenantId: tenantBId } })
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Customer of A");
  });

  // A bare, unscoped query (bypassing withTenant()) is NOT filtered by the
  // database -- there is no RLS backstop on this Postgres provider (see
  // migration 20260806120225_disable_inert_rls). Both seeded customers come
  // back here, which is the point: withTenant() is what enforces isolation,
  // not Postgres. Every future call site that touches a tenant-scoped table
  // must go through withTenant().
  it("returns rows unfiltered when bypassing withTenant (no DB-level backstop)", async () => {
    const customers = await prisma.customer.findMany({
      where: { tenantId: { in: [tenantAId, tenantBId] } },
    });
    expect(customers).toHaveLength(2);
  });
});
