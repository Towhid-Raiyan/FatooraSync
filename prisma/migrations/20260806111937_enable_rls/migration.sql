-- Enable Postgres Row-Level Security on all tenant-scoped tables.
--
-- Note: "tenantId" columns are Postgres TEXT (Prisma `String @default(uuid())`),
-- not the native `uuid` type, so the tenant filter compares as text. Casting
-- current_setting(...) to ::uuid here would fail with
-- "operator does not exist: text = uuid" against a text column.
--
-- FORCE ROW LEVEL SECURITY is required in addition to ENABLE ROW LEVEL SECURITY
-- because ENABLE alone exempts the table owner from its own policies. The
-- Prisma Client connects at runtime as "fatoorasync_app" (a role granted
-- privileges below, without BYPASSRLS), not as the table owner, so FORCE is
-- defense in depth here rather than the primary mechanism -- but it matters
-- because a role with BYPASSRLS ignores RLS regardless of FORCE, so keeping
-- the runtime role free of BYPASSRLS/SUPERUSER is what actually makes this
-- enforceable. Migrations run via DIRECT_URL as the "neondb_owner" role,
-- which does have BYPASSRLS, so schema changes are unaffected by these
-- policies.
--
-- User and Session intentionally have no RLS policy: login looks up a user by
-- email before any tenant context exists.

ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Customer"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Product"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Document"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "DocumentLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentLine"
  USING ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "Settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Settings"
  USING ("tenantId" = current_setting('app.tenant_id', true));

-- Grant the runtime role (fatoorasync_app, no BYPASSRLS) the privileges it
-- needs to operate on all tables -- a freshly created role has none by
-- default. RLS policies above still narrow which rows this role sees/affects
-- within each tenant-scoped table; these grants only control whether it can
-- touch the tables at all. Default privileges are set too, so future tables
-- created via later migrations are automatically usable by this role.
GRANT USAGE ON SCHEMA public TO fatoorasync_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fatoorasync_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fatoorasync_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fatoorasync_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fatoorasync_app;
