# Migrations: required bootstrap step

The `20260806111937_enable_rls` migration's `GRANT` and
`ALTER DEFAULT PRIVILEGES` statements target a Postgres role named
**`fatoorasync_app`** — the role the app's Prisma Client connects as at
runtime (`DATABASE_URL`), kept separate from the migration-owner role used
for `DIRECT_URL` as ordinary least-privilege practice (see `.env.example`
and that migration's own comments).

That role is **not created by any migration**. On the real Neon project it
was created by hand via the Neon dashboard, once, before the migration ever
ran. Migrations are immutable once applied (Prisma tracks them by checksum),
so `20260806111937_enable_rls` can't be edited now to add a
`CREATE ROLE IF NOT EXISTS` ahead of its own `GRANT`s without breaking the
checksum already recorded against the real database.

**Consequence:** running `prisma migrate deploy` (or `migrate dev`) against
*any fresh Postgres instance* — a new environment, a CI container, a second
developer's local database — fails on `20260806111937_enable_rls` with
`role "fatoorasync_app" does not exist`, unless that role is provisioned
first.

**This is intentional, not an oversight.** Role provisioning is a required
bootstrap step *outside* the migration chain, run once per fresh database,
before the first `prisma migrate deploy`:

```sql
CREATE ROLE fatoorasync_app LOGIN PASSWORD '<a-real-password>';
```

CI does exactly this — see the "Create application database role" step in
`.github/workflows/ci.yml` — and that workaround is the officially
sanctioned pattern for any other fresh environment, not a stopgap. A new
developer or a new deployment target should run the same `CREATE ROLE`
statement (with a real password, not committed anywhere) against their
Postgres instance before running migrations.

If this project ever moves off Neon to a Postgres provider where roles can
be created via SQL that migrations control end-to-end (e.g. one without
Neon's unavoidable `BYPASSRLS`), it's worth revisiting whether role
provisioning can move into the migration chain itself, ordered before any
`GRANT` depends on it.
