# FatooraSync — Agency Admin Panel v1 — Design Spec

**Status:** Approved
**Last updated:** 2026-08-16

## 1. Purpose

FatooraSync has its first real client to onboard. Today, onboarding means running a script by hand against production and editing `billingStatus` directly in the database — fine for zero customers, not for a real one.

This spec picks up the piece the [2026-08-14 agency platform design](2026-08-14-fatoorasync-agency-platform-design.md) identified as the unblocked next step (§"Next Steps": *"most likely §4's `Tenant`/`Settings` fields and the access gate, since the admin panel is built on top of them"*) — that gate is already shipped (Billing SDD, merged). This spec narrows the remaining `AgencyStaff` / `AuditLog` / admin-panel piece of that design into an implementation-ready v1: what to build now to onboard this client without touching the database by hand, versus what's real but deferred.

The higher-level decisions this spec depends on (data model shape, role semantics, security posture) were already resolved in the 2026-08-14 spec and are not re-litigated here — this document only adds what that one left as "a system to be built later": routes, screens, the auth mechanism, and exact v1 scope.

## 2. Scope

**Building now (v1):**
- `AgencyStaff` identity model + its own separate login, distinct from tenant Owner/Cashier auth
- `AuditLog` model, written on every sensitive admin action from day one (even before there's a screen to browse it)
- A left-sidebar admin shell at `/admin/*`, plain internal-tool styling (not the branded customer-facing design system)
- **Dashboard** (`/admin`) — tenant counts by billing status, a status-breakdown bar, recently-added tenants
- **Tenants** (`/admin/tenants`) — searchable list, create form (provisions the tenant + its Owner account in one step), detail screen with billing-status/trial/feature-flag editing
- Static **Analytics / Staff / Audit Log** roadmap screens — real pages, no fake data, explaining what each will do once built (keeps the nav honest rather than linking to nothing)
- A one-time seed script for the first CTO account

**Explicitly deferred** (nav items exist and are honest about it; nothing behind them is built):
- Staff management UI (CTO creating/removing Developer accounts) — moot with one agency person
- Impersonate-as-tenant
- Audit log *viewer* screen (writes happen now; browsing them is later)
- Real analytics/usage data collection

**Out of scope**, unchanged from the 2026-08-14 spec: payment gateway, self-serve signup, ZATCA Phase 2, offline sync, actual deployment/domain split.

## 3. Data Model

Two new models, both **deliberately outside `withTenant()`** — never add either to `TENANT_SCOPED_MODELS` in `src/lib/db/tenant-context.ts`. That extension exists to wall tenant data apart from other tenant data; `AgencyStaff` and `AuditLog` are agency-side by design and need to be queried with the raw `prisma` client, across every tenant.

```prisma
enum AgencyStaffRole {
  CTO
  DEVELOPER
}

model AgencyStaff {
  id           String          @id @default(uuid())
  email        String          @unique
  passwordHash String
  role         AgencyStaffRole @default(DEVELOPER)
  createdAt    DateTime        @default(now())

  auditLogs AuditLog[]
}

model AuditLog {
  id            String      @id @default(uuid())
  agencyStaffId String
  agencyStaff   AgencyStaff @relation(fields: [agencyStaffId], references: [id])
  action        String
  tenantId      String?
  metadata      Json        @default("{}")
  createdAt     DateTime    @default(now())
}
```

`action` is a free-text `String`, not a DB enum — later passes (impersonation, staff management) will add new action types, and a `String` avoids a migration per new action. v1 defines two constants in code (`src/lib/admin-auth/audit-actions.ts`):

```ts
export const AUDIT_ACTIONS = {
  TENANT_CREATED: "TENANT_CREATED",
  BILLING_STATUS_CHANGED: "BILLING_STATUS_CHANGED",
} as const;
```

**`seedTenant()` extension** (`src/lib/db/seed-tenant.ts`): `SeedTenantInput` gains optional `crNumber?`, `phone?`, `address?` — the schema already has these on `Tenant`, but the current interface only exposes `legalName`/`tradeNameEn`/`tradeNameAr`/`vatNumber`/`ownerEmail`/`ownerPassword`. The admin create-tenant form collects all of them; extending the existing helper (rather than duplicating its transaction) keeps one code path for "create a tenant" whether it's the CLI seed script or the admin API route calling it.

**Resolved: creation always starts `TRIALING`.** The create form does not ask for an initial billing status — every new tenant is created via `seedTenant()`, which already defaults `billingStatus` to `TRIALING` (schema default) and needs no change there. `trialEndsAt` is set to **14 days from creation** (a `seedTenant()` change: compute `new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)` and pass it in the transaction). Moving a tenant to `ACTIVE`/`COMPLIMENTARY`/etc. is a separate, deliberate action on the tenant detail screen — one billing-edit code path handles every status transition instead of duplicating status-setting logic into the create flow too.

## 4. Auth Architecture

A second, independent Auth.js v5 instance for `AgencyStaff` — same JWT-session machinery the tenant app already trusts, but its own login, its own cookie, zero chance of an admin session being read as a tenant one or vice versa.

**`src/lib/admin-auth/config.ts`** — mirrors `src/lib/auth/config.ts`'s shape (Credentials provider, `authorize()` checks `AgencyStaff` by email + `verifyPassword()`, same `argon2`-backed `password.ts` already in use), with:
- `basePath: "/api/admin-auth"` (tenant auth uses the default `/api/auth`)
- Distinct cookie name (e.g. `cookies: { sessionToken: { name: "admin-auth.session-token", ... } }`) so the two sessions can never collide or be confused by a shared cookie name
- JWT/session callbacks carry `agencyStaffId` and `role` (`CTO | DEVELOPER`), the admin equivalent of how `tenantId`/`role` travel through the tenant config
- 24h JWT expiry, matching the tenant session's existing tradeoff (documented there already: revocation on deactivation isn't instant — accepted for the same reason here)
- **Email matching is case-insensitive.** `authorize()` lowercases the submitted email before the `AgencyStaff` lookup, and the seed script (§7) stores the email lowercased at creation — consistent normalization on both sides, so `CTO@FatooraSync.sa` and `cto@fatoorasync.sa` are the same account. This is a deliberate departure from the tenant `User` path, which resolved a similar question by removing normalization entirely (see the Global Constraints note below for why the same fix doesn't apply here).

**No edge-safe split needed.** The tenant auth config is split across `auth.config.ts` (edge-safe, no providers) and `config.ts` (adds the Credentials provider) specifically because `src/middleware.ts` runs on the Edge runtime and can't bundle `argon2`. Admin auth is never checked from middleware (see below) — it's checked from a Server Component layout, which runs in the Node.js runtime — so one file is enough.

**`src/app/api/admin-auth/[...nextauth]/route.ts`** — `export const { GET, POST } = handlers` from the admin config, mirroring the tenant route handler exactly.

**Login without the client-side package.** Auth.js v5's server-exported `signIn`/`signOut` are usable directly as [Server Actions](https://authjs.dev/getting-started/authentication/credentials) — `<form action={signIn}>` — which sidesteps a real complication: `next-auth/react`'s client hooks assume one global instance and don't cleanly support pointing at a second `basePath` from client code. The admin login page is a plain Server Component form bound to the admin config's own `signIn` action; sign-out in the sidebar is the same pattern with `signOut`. **Implementation note for the build:** confirm this Server Action pattern's exact call shape against the installed `next-auth@5.0.0-beta.32` before writing it — beta APIs shift between minor versions.

**Middleware change** (`src/middleware.ts`): the existing matcher already covers virtually every route and redirects anything without a tenant session to `/login`. `/admin/*` and `/api/admin-auth/*` need to be excluded from that check entirely — they're guarded by a completely different session, not the tenant one this middleware reads:

```ts
const isPublic =
  req.nextUrl.pathname.startsWith("/login") ||
  req.nextUrl.pathname.startsWith("/api/auth") ||
  req.nextUrl.pathname.startsWith("/admin") ||
  req.nextUrl.pathname.startsWith("/api/admin-auth");
```

Actual admin authentication is enforced where the billing gate already lives — a **Server Component layout**, not middleware. This is the same pattern `src/app/(app)/layout.tsx` uses for the billing gate (calls `auth()`, redirects/blocks based on what it finds) — consistent with this codebase's established preference for gating in the server-rendered layer over edge middleware wherever the check needs real logic beyond "does a cookie exist."

## 5. Routes & Screens

Real `/admin` URL path segment (not a route-group `(admin)` folder — a route group wouldn't produce the `/admin` prefix this needs), sharing only the Prisma client with the rest of the app:

```
src/app/admin/
  login/
    page.tsx                    — public, plain Server Component + form Server Action
  (protected)/
    layout.tsx                  — calls admin auth(), redirects to /admin/login if absent;
                                   renders the sidebar shell around { children }
    page.tsx                    — Dashboard, at /admin
    tenants/
      page.tsx                  — Tenant list, at /admin/tenants
      new/
        page.tsx                — Create form, at /admin/tenants/new
      [id]/
        page.tsx                — Detail + billing edit, at /admin/tenants/[id]
    analytics/page.tsx          — static roadmap screen
    staff/page.tsx              — static roadmap screen
    audit/page.tsx              — static roadmap screen
```

`(protected)` here is a genuine route group (parentheses, no URL segment) purely to hang one shared auth-checking layout over every page except login, without affecting any of their URLs.

**Sidebar** — plain internal-tool styling per the approved mockup: wordmark top-left, two nav groups (**Business**: Dashboard, Tenants, Analytics; **Agency**: Staff, Audit Log), account block pinned to the bottom (avatar initials, email, role pill, sign-out). Analytics/Staff/Audit Log carry a small "soon" badge and link to their static roadmap pages rather than being disabled — clicking them isn't a dead end.

**API routes** (`src/app/api/admin/...`), all requiring a valid `AgencyStaff` session:

| Route | Method | Who | Does |
|---|---|---|---|
| `/api/admin/tenants` | GET | any AgencyStaff | List/search tenants (raw `prisma.tenant.findMany`, no `withTenant`) |
| `/api/admin/tenants` | POST | **CTO only** | Extended `seedTenant()` call; writes `TENANT_CREATED` to `AuditLog` |
| `/api/admin/tenants/[id]` | GET | any AgencyStaff | Tenant detail |
| `/api/admin/tenants/[id]/billing` | PATCH | **CTO only** | Updates `billingStatus`/`trialEndsAt`/`featureFlags`; writes `BILLING_STATUS_CHANGED` to `AuditLog` with `{ from, to }` in `metadata` |

The CTO-only restriction on create/billing-edit comes straight from the 2026-08-14 spec's role table (*"Developer:  ... cannot change billing, cannot create/delete staff or tenants"*) — moot with today's single CTO account, but implemented correctly now so it's already right when a Developer account exists later. A new guard module, `src/lib/admin-auth/require-cto.ts`, mirrors the existing `src/lib/rbac/require-owner.ts` pattern (`assertOwnerRole` → `assertCtoRole`) for consistency with how this codebase already writes role guards.

**Dashboard** computes its stats from a single unscoped `prisma.tenant.findMany({ select: { billingStatus: true } })`, grouping counts in application code (no need for a raw SQL aggregate at this data volume).

## 6. Tenant Provisioning & Billing-Edit Flows

**Create tenant** (`/admin/tenants/new`): business fields (legal name*, trade name EN*, trade name AR, VAT number*, CR number, phone, address) and an Owner-account section (email*, password*). The password field uses the **same interactive requirements checklist** already built for adding a Cashier (`src/components/settings/password-checklist.tsx` / `PASSWORD_RULES` from `src/lib/auth/password-rules.ts`) — the CTO sets the Owner's initial password directly, no invite email, matching the precedent already established for Owner→Cashier provisioning. On submit: `POST /api/admin/tenants` → extended `seedTenant()` → redirect to the new tenant's detail page, success toast.

**Billing edit** (`/admin/tenants/[id]`): read-only business-info card alongside an editable card — billing-status `<select>` (`TRIALING | ACTIVE | COMPLIMENTARY | PAST_DUE | SUSPENDED`), a trial-end date input (enabled only while status is `TRIALING`), and a feature-flags JSON textarea (raw JSON in, raw JSON out — no per-flag UI yet since no flags are defined anywhere in the product yet). Save → `PATCH /api/admin/tenants/[id]/billing`, success toast, and a small note under the form making the audit-log write visible: *"Recorded, not yet browsable — this is captured now, the screen to browse it is a later pass."*

**Status pill colors** (used on the list, detail, and dashboard breakdown): `TRIALING` amber, `ACTIVE` green, `COMPLIMENTARY` blue, `PAST_DUE` **solid red** (`#DC2626`), `SUSPENDED` a darker red (`#B3261E`) — distinguishable from `PAST_DUE` at a glance while both read unambiguously as "trouble."

## 7. First CTO Account

A one-time script, `prisma/seed-agency-staff.ts`, run once against production the same way `prisma/seed.ts` already seeds the demo tenant — takes an email/password (hardcoded in the script for a single run, same pattern as `prisma/seed.ts`'s demo credentials), hashes the password with the existing `hashPassword()`, and creates one `AgencyStaff` row with `role: CTO`. Not wired into any automated flow — the "create more staff" UI is explicitly deferred (§2), so this script is the only way an `AgencyStaff` row gets created until that ships.

## 8. Testing

Follows this codebase's existing conventions throughout:
- Pure logic (audit-action constants, any status-transition helpers) gets Vitest unit tests, no DB.
- API routes get integration tests against the real dev database via `withTenant`-style setup/teardown (matching `src/app/api/receipts/[id]/print-data/route.test.ts`'s pattern) — except these routes deliberately use the raw `prisma` client, so tests seed tenants directly rather than through `withTenant`.
- Auth: an `authorize()`-level test mirroring `src/lib/auth/config.test.ts`, covering wrong password, inactive/nonexistent account, and the CTO/Developer role landing in the JWT correctly.
- Role-guard tests for `assertCtoRole` mirroring `require-owner.ts`'s existing test coverage.
- Tenant-create and billing-edit route tests assert the matching `AuditLog` row was written (`action`, `tenantId`, `metadata`), not just the primary create/update — the audit trail is a v1 requirement, not incidental.
- No new browser/E2E infra — manual verification in the dev server (as this whole engagement has done throughout) before merge, same as every prior feature.

## 9. Global Constraints

- `AgencyStaff` and `AuditLog` must never be added to `TENANT_SCOPED_MODELS` (`src/lib/db/tenant-context.ts`) — all admin-panel queries use the raw `prisma` client directly.
- Admin auth is checked in `src/app/admin/(protected)/layout.tsx`, never in `src/middleware.ts` — middleware only excludes `/admin` and `/api/admin-auth` from the *tenant* session check.
- Tenant creation and billing/feature-flag edits require `AgencyStaffRole.CTO`; read-only tenant list/detail is open to any `AgencyStaff`.
- Every sensitive admin action (tenant creation, billing-status change) writes to `AuditLog` in the same request, even with no viewer screen yet.
- Admin panel UI uses plain internal-tool styling (shadcn/ui primitives, brand green as an accent only) — no `DesertScene`, no shared sidebar component with the tenant app.
- `trialEndsAt` on tenant creation defaults to 14 days out.
- **`AgencyStaff` email matching is case-insensitive via consistent lowercasing** — the seed script stores the email lowercased, and `authorize()` lowercases the submitted email before matching. Both sides do the *same* transformation, which is what actually matters: the tenant `User` bug this echoes (RBAC branch: `POST /api/users` lowercased on create, `authorize()` matched exact-case on login, silently bricking new Cashier logins) was caused by the two sides doing *different* things, not by normalization itself. That bug's fix removed normalization entirely because the tenant `User` creation path (Owner adding a Cashier) had no reason to prefer one approach over the other and removing it was the smaller diff — it is not evidence that normalization is unsafe. Here, case-insensitive login is the better UX and is deliberately chosen; the discipline that matters is keeping the seed script and `authorize()` doing the exact same lowercasing, not avoiding normalization altogether.
