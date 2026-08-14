# FatooraSync — Tenant-Side RBAC (Owner/Cashier) — Design Spec

**Status:** Approved
**Last updated:** 2026-08-14

## 1. Purpose

The agency-platform design spec ([2026-08-14-fatoorasync-agency-platform-design.md](2026-08-14-fatoorasync-agency-platform-design.md)) resolved the shape of tenant-side RBAC at a design level (§3, §4, §5) but deliberately left it for a later implementation cycle. This spec picks that piece up and works out the parts the earlier spec didn't need to: exactly which fields, routes, and screens change, and the Owner-facing UI for actually creating a Cashier account — without which the role split would have nothing to test against.

Everything below is additive to, not a replacement for, the resolved decisions in §3-§5 of the agency-platform spec. Where this doc repeats a decision from there, it's for implementation traceability, not re-litigation.

## 2. Scope

**In scope:**
- `User.role` (`OWNER | CASHIER`) and `User.isActive`, plus the session plumbing to carry `role` alongside the existing `tenantId`
- Enforcing the three-tier access model (agency-platform spec §5) at both the page and API layer, for Settings and for Products/Customers management
- An Owner-facing "Staff" section on the Settings page: list Cashiers, add a Cashier, deactivate/reactivate a Cashier
- An interactive password-requirements checklist for the Add Cashier form

**Explicitly out of scope** (unchanged from the agency-platform spec): the `AgencyStaff` model, the internal admin panel, the audit log, and everything else that spec deferred.

## 3. Data Model

**`User`** (existing model) gains:
- `role: UserRole` (`OWNER | CASHIER`), `@default(OWNER)`
- `isActive: Boolean`, `@default(true)`

Every existing `User` row was, until now, implicitly an Owner (the MVP never had a second role) — the `@default(OWNER)` means every current row is correct the instant the migration runs, with no backfill statement needed. Same shape as `Tenant.billingStatus`'s `@default(TRIALING)` in the billing-gate slice.

`"User"` is added to `TENANT_SCOPED_MODELS` in [tenant-context.ts](../../../src/lib/db/tenant-context.ts). Any new Cashier-management code that goes through `withTenant()` gets `tenantId` auto-injected on every operation, the same guarantee every other tenant-scoped model already has — an Owner cannot read or write another tenant's `User` rows even by guessing an id.

This does **not** change `authorize()`'s existing `prisma.user.findUnique({ where: { email } })` login lookup, which runs on the raw (non-tenant-scoped) client because at that point in the request there is no `tenantId` yet — email is the only key available, and it's globally unique across the whole platform.

## 4. Session & Login

`authorize()` (`src/lib/auth/config.ts`) changes in two ways:
- After password verification, also checks `user.isActive`. A deactivated user's login fails exactly like a wrong password (returns `null`) — no distinct error message, so a deactivated Cashier's login attempt can't be used to confirm the account exists.
- The object it returns on success gains `role: user.role`, alongside the existing `id`/`email`/`tenantId`.

`auth.config.ts`'s `jwt`/`session` callbacks carry `role` through exactly like `tenantId` already does:

```ts
jwt: ({ token, user }) => {
  if (user) {
    token.tenantId = (user as { tenantId: string; role: string }).tenantId;
    token.role = (user as { tenantId: string; role: string }).role;
  }
  return token;
},
session: ({ session, token }) => ({
  ...session,
  user: { ...session.user, tenantId: token.tenantId as string, role: token.role as string },
}),
```

`session.user.role` is then available anywhere `session.user.tenantId` already is — `(app)/layout.tsx`, every API route handler — with no additional database query.

## 5. The Three-Tier Model, Applied

(Restating agency-platform spec §5 for implementation traceability.)

1. **Always Cashier, no gating:** New Receipt, New Quotation, and the item-search inside them. Nothing here changes — already open to any authenticated user regardless of role.
2. **Owner's toggle** (`Settings.cashierCanManageCatalog`, already in the schema from the billing-gate slice, default `true`, unused until now): governs create/edit/deactivate/reactivate — the full set of mutation actions — on Products and Customers. Search and view are never gated; a Cashier can always open `/products` and `/customers` to look things up. When the toggle is on (the default — meaning the Owner has not restricted it), a Cashier has the exact same Product/Customer CRUD capability an Owner does. Only when the Owner explicitly turns it off does the Cashier drop to view/search-only.
3. **Always Owner, no toggle:** `/settings` (including the new Staff section), and by extension every settings-related API route.

**Page layer:**
- `products-client.tsx` and its Customers equivalent: the "Add Product"/"Add Customer" button and each row's Edit/Deactivate buttons render only when `role === "OWNER" || cashierCanManageCatalog`. The page and its search/list stay visible regardless.
- `/settings/page.tsx`: if `session.user.role !== "OWNER"`, redirect to `/` (Home) — matches the app's existing use of a redirect rather than an error screen for "you're logged in but this isn't for you" (as opposed to `BlockedScreen`, which is reserved for billing issues, not role issues).
- `sidebar.tsx`/`nav-items.ts`: the Settings nav item is omitted from the rendered list for a Cashier (not just visually disabled, unlike the existing "coming soon" `href: null` items — Cashiers shouldn't see it at all).

**API layer** (mirrors the billing-gate slice's page+API dual enforcement — client-side hiding is never sufficient on its own):
- `POST /api/products`, `PATCH /api/products/[id]`, `POST /api/customers`, `PATCH /api/customers/[id]`: after the existing `assertTenantAccess` check, also reject with 403 when `role === "CASHIER" && !cashierCanManageCatalog`. Reading `cashierCanManageCatalog` requires one `Settings` lookup per request — already the query shape `withTenant()` performs elsewhere, no new pattern.
- `PATCH /api/settings`: reject with 403 when `role !== "OWNER"`.
- `GET`/`POST /api/products`, `GET`/`POST /api/customers`: unchanged — read access was never role-gated (Tier 1).

## 6. The Staff Section (Add/Manage Cashiers)

A new card on the existing Settings page, below the current settings card — Settings is already Owner-only, so no additional page-level gating is needed for this section specifically.

**UI** (`src/components/settings/staff-section.tsx`, following the same list+dialog shape as `products-client.tsx`/`ProductFormDialog`):
- A table of the tenant's Cashiers: email, Active/Inactive badge, a Deactivate/Reactivate button.
- An "Add Cashier" button opening a dialog with two fields: email, password.
- The password field renders a live checklist of four rules (§7) below it; each satisfied rule shows a green check with a brief scale+color transition. The dialog's submit button is disabled until every rule passes and the email field is non-empty.

**API:**
- `POST /api/users` (Owner-only): validates the password against the shared rule set (§7), returns 400 listing which rule(s) failed if not met; hashes the password with the existing `hashPassword()`; creates a `User` with `role: "CASHIER"`, `isActive: true`, in the caller's own tenant via `withTenant()`. Returns 409 with a clear message if the email is already in use — email is globally unique (same constraint Owner accounts already have), so this reuses the existing uniqueness-conflict pattern from Products (barcode) and Customers (VAT ID).
- `PATCH /api/users/[id]` (Owner-only): accepts `{ isActive: boolean }`, updates via `withTenant()` (so the tenant scope makes it impossible to target another tenant's user). No other field is editable through this endpoint.

Both endpoints check `session.user.role === "OWNER"` before doing anything else, same position in the handler as the existing `assertTenantAccess` check.

## 7. Password Requirements

A shared, pure rule set — `src/lib/auth/password-rules.ts` — is the single source of truth for both the client-side checklist and the server-side check, so the two can never drift apart (same reasoning as `calculate-totals.ts` being shared across the client display and the server's price trust boundary):

```ts
export interface PasswordRule {
  id: string;
  label: string; // dictionary key, not literal text -- see i18n note below
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "minLength", label: "...", test: (p) => p.length >= 8 },
  { id: "uppercase", label: "...", test: (p) => /[A-Z]/.test(p) },
  { id: "number", label: "...", test: (p) => /[0-9]/.test(p) },
  { id: "special", label: "...", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function isPasswordValid(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}
```

Labels are dictionary keys resolved at render time in the client component (this codebase's i18n dictionary is the single source of copy — see `src/lib/i18n/dictionaries/`), not literal strings baked into the rules array. `POST /api/users` calls `isPasswordValid()` directly; the client checklist maps over `PASSWORD_RULES` to render each row's live state.

This rule set applies only to Cashier account creation — it does not retroactively apply to the existing Owner-provisioning flow (`seed-tenant.ts`), which is out of scope for this slice.

## 8. What Does Not Change

- Receipt/Quotation creation and the billing access gate (`isAccessAllowed`/`assertTenantAccess`) are untouched and apply identically regardless of role.
- `AgencyStaff`, the admin panel, and the audit log remain future work per the agency-platform spec.
- No changes to `Tenant`-level fields or the billing gate's own logic.
