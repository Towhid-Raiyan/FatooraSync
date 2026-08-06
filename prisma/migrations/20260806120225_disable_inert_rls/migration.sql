-- Disable and drop the Postgres RLS policies added in the enable_rls
-- migration. They were never actually enforced: Neon grants every role we
-- can create -- including a dedicated non-superuser role created
-- specifically to avoid it -- the BYPASSRLS attribute, with no way to
-- remove it via SQL or the Neon dashboard (confirmed via Neon's own
-- dashboard-privileged SQL Editor). FORCE ROW LEVEL SECURITY has no effect
-- against a BYPASSRLS role, so these policies were silently inert rather
-- than protective. Leaving them in place would be misleading: they look
-- like a real backstop but do nothing. Tenant isolation for this phase is
-- enforced entirely in the application layer, via the withTenant() Prisma
-- Client Extension in src/lib/db/tenant-context.ts.
--
-- The GRANT / ALTER DEFAULT PRIVILEGES statements from enable_rls are left
-- in place: the fatoorasync_app role still needs table access for the
-- application-layer enforcement to run real queries, it just no longer
-- relies on RLS to filter them.

ALTER TABLE "Customer" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Customer" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Customer";

ALTER TABLE "Product" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Product" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Product";

ALTER TABLE "Document" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Document" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Document";

ALTER TABLE "DocumentLine" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "DocumentLine" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DocumentLine";

ALTER TABLE "Settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Settings" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Settings";
