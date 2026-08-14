# FatooraSync — Agency Control Plane & Access Model — Design Spec

**Status:** Approved
**Last updated:** 2026-08-14

## 1. Purpose

FatooraSync (the product) is functionally complete against its original MVP scope. This spec covers the layer *around* the product that turns it into something a SaaS agency can actually sell, provision, and support: who can control a tenant's access from the outside, and who can do what inside a tenant once they're in.

This is a design spec for a system to be built later, not an implementation plan — it fixes the decisions and the shape of the data model so that when this work is picked up, it starts from an agreed design rather than open questions.

## 2. Scope

**In scope for this design:**
- A billing/access-status field on the tenant, and the gate that checks it
- Per-tenant feature flags
- Two-tier access *inside* a tenant: Owner and Cashier, including one Owner-controlled permission toggle
- A separate staff/access model *outside* any tenant: CTO and Developer, for your own agency
- An audit log for actions that cross the tenant boundary
- The internal admin panel that manages all of the above
- Guidance on repo/deployment structure for the admin panel, and the trigger condition for revisiting it

**Explicitly out of scope for this cycle** (deferred on purpose, not forgotten):
- Actual deployment / domain split (`app.` / `admin.` subdomains) — next trigger is your first real client
- A real payment gateway integration (Moyasar/Tap/PayTabs/etc.) — build once self-serve billing is worth the investment
- Self-serve signup — manual, admin-provisioned onboarding is the right shape for an agency doing direct outreach at this stage
- ZATCA Phase 2 (live API submission, cryptographic stamping) — kept on the roadmap, deliberately not touched until you're ready to formally register with ZATCA's live environment
- Offline-first sync and the desktop (Tauri) app — tied to real demand, not built speculatively

## 3. Requirements Review — Resolved Decisions

| Area | Decision | Rationale / notes |
|---|---|---|
| Billing/access control | A `billingStatus` field on `Tenant`, checked before the app loads | Single mechanism answers both "suspend a non-payer" and "give this client free access forever" — no separate free-tier system |
| Free/complimentary access | `billingStatus = COMPLIMENTARY`, set only from the admin panel | No payment provider is ever involved for these accounts |
| Where the gate runs | In the main app's server-rendered layer (same place `resolveLocale()` already runs), not in edge middleware | Middleware can't cheaply re-check the database on every request without embedding status in the JWT — and a JWT-embedded status would only refresh on next login (up to 24h later). A suspended tenant should be cut off immediately, not "whenever their session happens to expire" |
| Feature flags | A `featureFlags` field on `Tenant`, agency-controlled | Lets you give an individual client early access to something, or hold a feature back, without a code branch per client |
| Tenant roles | `User` gains a `role`: `OWNER \| CASHIER` | The original MVP spec explicitly reserved this ("schema allows staff roles later") — this is that moment, on schedule, not scope creep |
| Owner reach | Owner reaches everything in their tenant: Products, Customers, Receipts/Quotations, Settings, and any future Statistics/Reports screen | No toggle — Owner is the ceiling |
| Cashier reach (fixed) | Cashier always reaches New Receipt, New Quotation, and Products/Customers search — never Settings, never future Statistics | These are the till-work actions every cashier needs regardless of the shop's preference |
| Cashier reach (owner-controlled) | Managing Products/Customers (create/edit, not just search) is gated by `Settings.cashierCanManageCatalog`, a boolean the Owner controls, **defaulting to `true`** | Most small shops want their cashier stocking and pricing too — default matches that, but the Owner can restrict it per shop at any time |
| Field placement: `billingStatus`/`trialEndsAt`/`featureFlags` | Live on `Tenant`, not `Settings` | These are agency-controlled account facts, not shop preferences — a tenant should never be able to read or write these through the same API surface as their own Settings page |
| Field placement: `cashierCanManageCatalog` | Lives on `Settings`, not `Tenant` | This one *is* an owner-controlled preference — the opposite direction of control from the fields above, so it belongs on the opposite model |
| Agency staff identity | A new, separate `AgencyStaff` model — not a role on `User` | `User` rows are tenant-scoped by design (that's the whole point of the tenant-isolation layer); agency staff need to see *across* tenants, which is a different shape of access and must never share a table with tenant-scoped data |
| Agency roles | `AgencyStaff.role`: `CTO \| DEVELOPER` | CTO: full control, including billing overrides, tenant suspension/deletion, and managing other agency staff accounts. Developer: support and fixes — can impersonate a tenant to help with configuration, cannot change billing, cannot create/delete staff or tenants |
| Impersonation | A Developer or CTO can start an "as this tenant" session from the admin panel; every impersonation session is written to the audit log | This is the one sanctioned crossing from Agency Land into a tenant's wall — it needs to be visible after the fact, not just permitted in the moment |
| Audit log | New `AuditLog` model, written for every impersonation and every sensitive admin action (billing change, tenant suspension, staff account changes) | Cheap to build alongside the admin panel; expensive to reconstruct after an incident if it's missing |
| Owner self-service for adding Cashiers | **Open — not yet decided.** See §7 | Genuine product decision, not an engineering one |
| Repo structure | Stay in one repo, one deploy, with the admin surface as its own isolated route group (`(admin)`) — sharing only the Prisma client with the customer app, nothing else | The admin panel's real feature set isn't proven out yet; a monorepo split before that is process paid for early with no benefit yet |
| Trigger to revisit repo structure | A second developer joins, or the admin surface needs its own network-level restrictions (VPN/IP allowlist) that would be awkward to apply to only half of one deployed app | At that point, migrate to a monorepo (e.g. Turborepo: `apps/web` + `apps/admin` + shared `packages/db`) — the same Prisma schema either way, so this is a deploy-boundary change, not a data-model change |
| Deployment timing | Not now — build and verify locally against the existing dev database | Nothing in this spec requires a live domain; deployment is the correct trigger for the *next* piece of work, once there's a real client to onboard |
| ZATCA Phase 2 | Deferred, kept on the roadmap | It's a real integration against a government API — worth doing once, correctly, when you're actually ready to register, not speculatively now |

## 4. Data Model Additions

**`Tenant`** (agency-controlled — never editable by the tenant's own users):
- `billingStatus`: `TRIALING | ACTIVE | COMPLIMENTARY | PAST_DUE | SUSPENDED`
- `trialEndsAt`: nullable timestamp
- `featureFlags`: JSON, agency-set per tenant

**`Settings`** (owner-controlled — editable from the tenant's own Settings page):
- `cashierCanManageCatalog`: boolean, default `true`

**`User`** (existing model, tenant-scoped):
- `role`: `OWNER | CASHIER`
- The existing "one user per tenant" assumption is retired — a tenant now has exactly one Owner and any number of Cashiers

**`AgencyStaff`** (new model, deliberately outside the tenant-isolation extension — never touched by `withTenant()`):
- `email`, `passwordHash`, `role: CTO | DEVELOPER`, `createdAt`
- Own authentication flow, own session, entirely separate from tenant `User` login

**`AuditLog`** (new model):
- `agencyStaffId`, `action` (e.g. `IMPERSONATE_START`, `BILLING_STATUS_CHANGED`, `TENANT_SUSPENDED`, `AGENCY_STAFF_CREATED`), `tenantId` (nullable — some actions aren't tenant-specific), `metadata` (JSON), `createdAt`

## 5. The Access Model

**Two separate worlds.** Tenant Land is a set of walled-off shops — the existing Prisma-extension isolation layer already guarantees Shop A's queries can never touch Shop B's rows, and nothing in this spec changes that. Agency Land is a single connected space that can see across every shop, because that's what running the business requires. The two worlds are connected by exactly one sanctioned path — impersonation — and that path is always audited.

**Inside one shop, three tiers, not two:**
1. **Always Cashier** — New Receipt, New Quotation, Products/Customers search. Fixed, no toggle.
2. **Owner's toggle, on by default** — managing (not just searching) Products/Customers. The Owner can restrict this per shop.
3. **Always Owner** — Settings, and any future Statistics/Reports surface. No toggle exists for this tier; it's a hard ceiling.

This three-tier shape (fixed-for-role / owner-togglable / fixed-for-role) is worth keeping as the general pattern for future features, not a one-off for the catalog permission — the next time a new capability needs gating, the first question should be which of these three tiers it belongs to.

## 6. The Admin Panel

Built on top of §4-5, giving agency staff:
- Tenant list, search, create (the manual-onboarding provisioning flow)
- Set `billingStatus` / `trialEndsAt` / `featureFlags` per tenant
- Impersonate-as-tenant, always audit-logged
- Agency staff management (CTO only: create/remove Developer and CTO accounts)
- A view of the audit log itself

Security note carried forward from the earlier discussion: this panel is the one part of the system explicitly designed to bypass the tenant-isolation boundary. It deserves its own scrutiny beyond the customer-facing app — strong auth for agency accounts (2FA worth considering even at small scale), and every cross-tenant action logged, not just the destructive ones.

## 7. Open Question

**Can an Owner add their own Cashiers (self-service, from their own Settings), or does every new Cashier login get created by agency staff through the admin panel?**

Not resolved yet — this is a product call, not an engineering one. Self-service is lower-friction for the Owner and keeps the agency out of routine staffing changes; agency-mediated keeps a single, deliberate provisioning path but adds you as a dependency for something that will happen often once a client has more than one staff member. Needs a decision before implementation planning starts on tenant-side RBAC.

## Next Steps

Pick up implementation planning for whichever piece is prioritized first — most likely §4's `Tenant`/`Settings` fields and the access gate, since the admin panel (§6) is built on top of them and can't meaningfully exist without them first. Resolve §7 before planning the Owner/Cashier work specifically.
