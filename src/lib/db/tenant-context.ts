import { prisma } from "./client";

const TENANT_SCOPED_MODELS = new Set([
  "Customer",
  "Product",
  "Document",
  "DocumentLine",
  "Settings",
  "User",
  "Supplier",
  "StockMovement",
]);

/**
 * Application-layer tenant isolation, via a Prisma Client Extension.
 *
 * The original design for this task used Postgres Row-Level Security as a
 * database-level backstop. That doesn't work on Neon: every role we can
 * create -- including a dedicated non-superuser role created specifically to
 * avoid it -- carries the BYPASSRLS attribute, with no way to remove it via
 * SQL or the Neon dashboard (confirmed via Neon's own dashboard-privileged
 * SQL Editor). RLS policies were silently inert regardless of FORCE ROW
 * LEVEL SECURITY. See migration 20260806120225_disable_inert_rls for the
 * cleanup of that abandoned approach.
 *
 * Instead, every query against a tenant-scoped model made through the
 * client returned by forTenant() has `tenantId` injected directly into its
 * `where`/`data` args before the query runs, so a call site cannot forget
 * the filter. A caller-supplied `tenantId` in `where` or `data` is
 * overridden, not merged, because it's spread first and `tenantId` is
 * applied after -- this applies to `update`/`updateMany`/
 * `updateManyAndReturn` too, so a caller can't relocate a row into another
 * tenant's dataset via `data.tenantId` even though `where.tenantId` is
 * correctly scoped to the active tenant.
 *
 * Known limitation: this only intercepts top-level model operations. Nested
 * writes through `include` / `data: { relation: { create: ... } }` do NOT
 * get `tenantId` auto-injected on the nested model -- always pass `tenantId`
 * explicitly in nested writes to tenant-scoped models, or perform them as
 * separate top-level calls through the same withTenant() client.
 */
function forTenant(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const filteredOps = new Set([
            "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
            "count", "aggregate", "groupBy",
            "update", "updateMany", "updateManyAndReturn",
            "delete", "deleteMany",
          ]);

          const typedArgs = args as {
            where?: Record<string, unknown>;
            data?: unknown;
            create?: Record<string, unknown>;
            update?: Record<string, unknown>;
          };

          if (operation === "upsert") {
            // upsert is both a read-filter (where) and a write-stamp
            // (create/update sub-objects) in one call - all three need
            // tenantId injected, or a caller could read/write another
            // tenant's row via the where clause, or create/update a row
            // silently outside the active tenant.
            typedArgs.where = { ...typedArgs.where, tenantId };
            typedArgs.create = { ...typedArgs.create, tenantId };
            typedArgs.update = { ...typedArgs.update, tenantId };
          } else if (filteredOps.has(operation)) {
            // tenantId must come after the spread so it always wins over
            // any tenantId the caller passed - override, never merge.
            typedArgs.where = { ...typedArgs.where, tenantId };

            // update/updateMany/updateManyAndReturn also carry a `data`
            // payload that can itself contain a caller-supplied tenantId
            // (e.g. data: { tenantId: otherTenant, ... }). Without also
            // stamping data.tenantId here, `where` would correctly find the
            // active tenant's own row, but the write would relocate it into
            // another tenant's dataset. Same override-not-merge rule as
            // everywhere else: tenantId is applied after the spread.
            if (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") {
              typedArgs.data = { ...(typedArgs.data as Record<string, unknown>), tenantId };
            }
          }
          if (operation === "create") {
            typedArgs.data = { ...(typedArgs.data as Record<string, unknown>), tenantId };
          }
          if (operation === "createMany" || operation === "createManyAndReturn") {
            typedArgs.data = (typedArgs.data as Record<string, unknown>[]).map((row) => ({ ...row, tenantId }));
          }

          return query(typedArgs as typeof args);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof forTenant>;

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantClient) => Promise<T>
): Promise<T> {
  return fn(forTenant(tenantId));
}
