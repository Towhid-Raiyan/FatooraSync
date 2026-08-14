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
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
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

  it("scopes upsert to the active tenant, both in where and in create/update", async () => {
    const target = await withTenant(tenantAId, (tx) =>
      tx.customer.create({ data: { tenantId: tenantAId, name: "Upsert Target" } })
    );

    try {
      // where.tenantId names tenant B; create/update also don't mention the
      // real tenant. If any of the three weren't overridden, this would
      // either miss the existing tenant-A row (falling through to create,
      // under the wrong tenant) or leave the update unscoped.
      const result = await withTenant(tenantAId, (tx) =>
        tx.customer.upsert({
          where: { id: target.id, tenantId: tenantBId },
          create: { tenantId: tenantBId, name: "Should not be created" },
          update: { name: "Updated by upsert" },
        })
      );

      expect(result.id).toBe(target.id);
      expect(result.tenantId).toBe(tenantAId);
      expect(result.name).toBe("Updated by upsert");

      const totalCustomers = await withTenant(tenantAId, (tx) => tx.customer.count());
      // The upsert must have matched and updated the existing row, not
      // created a second one under tenant B that would be invisible here.
      expect(totalCustomers).toBe(2);
    } finally {
      await withTenant(tenantAId, (tx) => tx.customer.delete({ where: { id: target.id } }));
    }
  });

  it("overrides a caller-supplied tenantId in update's data, not just its where", async () => {
    const target = await withTenant(tenantAId, (tx) =>
      tx.customer.create({ data: { tenantId: tenantAId, name: "Update Target" } })
    );

    try {
      // A malicious/buggy caller passes tenantId: tenantB inside `data`.
      // `where` is correctly scoped by the extension and finds tenant A's
      // own row, so the update must still apply -- but if data.tenantId
      // weren't also overridden, this write would relocate the row into
      // tenant B's dataset.
      const result = await withTenant(tenantAId, (tx) =>
        tx.customer.update({
          where: { id: target.id },
          data: { tenantId: tenantBId, name: "Renamed by update" },
        })
      );

      expect(result.tenantId).toBe(tenantAId);
      expect(result.name).toBe("Renamed by update");

      const reloaded = await withTenant(tenantAId, (tx) => tx.customer.findUniqueOrThrow({ where: { id: target.id } }));
      expect(reloaded.tenantId).toBe(tenantAId);

      // Confirm it did NOT end up visible under tenant B.
      const seenByB = await withTenant(tenantBId, (tx) => tx.customer.findMany({ where: { id: target.id } }));
      expect(seenByB).toHaveLength(0);
    } finally {
      await withTenant(tenantAId, (tx) => tx.customer.delete({ where: { id: target.id } }));
    }
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

  it("scopes User rows to the active tenant, same as Customer", async () => {
    await withTenant(tenantAId, (tx) =>
      tx.user.create({ data: { tenantId: tenantAId, email: "owner-a@tenant-isolation-test.local", passwordHash: "x" } })
    );
    await withTenant(tenantBId, (tx) =>
      tx.user.create({ data: { tenantId: tenantBId, email: "owner-b@tenant-isolation-test.local", passwordHash: "x" } })
    );

    const usersSeenByA = await withTenant(tenantAId, (tx) => tx.user.findMany());
    expect(usersSeenByA).toHaveLength(1);
    expect(usersSeenByA[0].email).toBe("owner-a@tenant-isolation-test.local");
  });
});
