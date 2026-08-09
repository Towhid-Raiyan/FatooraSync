# FatooraSync — Customers Section Design

**Status:** Approved
**Last updated:** 2026-08-09

## 1. Why this exists

The design system foundation (`2026-08-09-fatoorasync-design-system.md`) shipped the reusable app shell, theme, and component patterns but no real feature screens beyond Settings and Home. This is the first of three planned feature builds on top of it — Customers, then Products, then Sales Receipt & Quotation — each shipped and reviewed independently. This spec covers Customers only: full CRUD, tenant-scoped, following the MVP spec's data model and soft-delete rule.

## 2. Data model

Uses the existing `Customer` model (already in `prisma/schema.prisma`, unchanged): `tenantId`, `name`, `vatId` (nullable, unique within a tenant), `address`, `phone`, `crNumber`, `isWalkIn`, `isActive` (soft-delete flag), `createdAt`. No migration needed for this feature.

Every tenant already has a non-deletable, auto-seeded `isWalkIn: true` "Walk-in Customer" row (`seed-tenant.ts`), used today by nothing (no receipt flow exists yet) but reserved for the future Sales Receipt screen's "no named customer" case.

## 3. API — Route handlers under `src/app/api/customers/`

Same pattern as the existing `/api/settings` route: Next.js Route Handlers, `auth()` for the session, `withTenant()` for tenant-scoped Prisma access, manual validation (no schema-validation library introduced — matches the codebase's existing style).

- **`GET /api/customers`** — returns all of the tenant's customers, active and inactive together, sorted by name. No query-param filtering; the frontend filters client-side (see §4). 401 if unauthenticated.
- **`POST /api/customers`** — creates a customer. Body: `{ name, vatId?, crNumber?, phone?, address? }`. `name` is required and must be non-empty after trimming — 400 otherwise. A `vatId` that collides with another customer in the same tenant (the DB's `@@unique([tenantId, vatId])` constraint, Prisma error code `P2002`) returns 409 with a message identifying the VAT ID conflict, not a raw 500. 401 if unauthenticated.
- **`PATCH /api/customers/[id]`** — partial update. Body may include any of `{ name, vatId, crNumber, phone, address, isActive }`. Same `name`-non-empty and VAT-ID-conflict validation as POST, when those fields are present. **Server-side guard:** if the target customer has `isWalkIn: true`, the request is rejected with 403 regardless of which fields were sent — the Walk-in Customer cannot be edited, deactivated, or reactivated through this endpoint. 404 if the customer doesn't exist (or belongs to another tenant — `withTenant` makes a cross-tenant `id` simply not match, which naturally surfaces as "not found" rather than leaking existence). 401 if unauthenticated.
- No `DELETE` endpoint. Per the MVP spec's soft-delete rule, "deletion" is always `PATCH { isActive: false }` — historical documents referencing a deactivated customer keep working.
- Note on the VAT ID uniqueness constraint: Postgres treats multiple `NULL` values in a unique index as distinct from each other (not a conflict), so any number of customers with no VAT ID is allowed — the constraint only fires when two customers in the same tenant share the same *non-null* VAT ID.

## 4. Frontend

**Page:** `src/app/(app)/customers/page.tsx` — an async Server Component. Fetches the session and the tenant's full customer list via `withTenant` directly (same pattern as the Home dashboard page), passes the list to a Client Component. This avoids the loading-flash that `/settings`'s fetch-on-mount pattern has, since Settings' existing behavior isn't being touched and this is a fresh page.

**`CustomersClient`** (`src/components/customers/customers-client.tsx`, `"use client"`): owns all interactive state — search text, "show inactive" toggle, which modal (if any) is open, which customer is being edited.

- **Toolbar row:** a search `Input` (live filter, client-side, matching against `name`, `vatId`, `phone` case-insensitively — no server round-trip), a "Show inactive" toggle/checkbox, and a "+ Add Customer" `Button` (`variant="primary"`) at the top-right — this page's one primary action, per the design system's single-location rule.
- **Table** (inside a `Card`, matching the design system's table pattern — right-align nothing here since there are no numeric columns, row hover highlight, subtle border): columns Name, VAT ID, CR Number, Phone, Address, Actions. Filtered/sorted client-side from the full fetched list — no re-fetch on search keystrokes or toggle changes.
  - Inactive rows (when the toggle reveals them) render with muted/grayed text to visually distinguish them from active customers.
  - The Walk-in Customer row renders a small "System" badge in the Name cell and has **no** Edit or Deactivate action in its Actions cell (empty/blank there) — matches the API's server-side lock.
  - Active customers get "Edit" and "Deactivate" row actions; inactive customers get "Edit" and "Reactivate" (editing a deactivated customer is allowed — only the active/inactive toggle itself and the walk-in lock are restricted).
- **Empty state:** if there are zero non-walk-in customers (regardless of the inactive toggle), the table area is replaced with a centered message: "No customers yet — add your first one," plus the same "+ Add Customer" action.

**Add/Edit modal:** shadcn `Dialog`, one shared component (`CustomerFormDialog`) used for both create and edit, switching on whether an existing customer was passed in. Fields, in order: Name (required), VAT ID, CR Number, Phone, Address — same set and order as the design system spec's worked Sales Receipt customer card, so the field vocabulary stays consistent once that screen ships. Labels use the design system's label treatment (`text-[10.5px] font-bold uppercase tracking-wider text-muted-fg`). Submitting calls `POST` (create) or `PATCH` (edit); on success, closes the dialog and updates the in-memory list (no full page refetch); on failure, shows the server's error message inline in the dialog, near the top of the form (not a toast — keeps the failure visible next to the form the user is still looking at).

## 5. Validation & error handling

| Case | Behavior |
|---|---|
| Empty/whitespace-only name | 400 from the API; dialog shows "Name is required" inline, submit blocked |
| Duplicate VAT ID within the tenant | 409 from the API; dialog shows "This VAT ID is already used by another customer" |
| Edit/deactivate/reactivate on the Walk-in Customer | 403 from the API (defense in depth — the UI already hides these actions for that row, so this path shouldn't be reachable through normal use) |
| Unauthenticated request | 401 from the API (matches every existing route) |
| Customer not found / belongs to another tenant | 404 from the API |

## 6. Testing

`src/app/api/customers/route.test.ts` and `src/app/api/customers/[id]/route.test.ts`, following `settings/route.test.ts`'s exact harness (`vi.mock` on `@/lib/auth/config`, a real tenant + real DB rows created in `beforeAll`, cleaned up in `afterAll`). Covers:
- List returns only the calling tenant's customers (tenant isolation — create a second tenant with its own customer in the test, assert it never appears)
- Create succeeds with valid data, 400 on empty name, 409 on duplicate VAT ID within a tenant (and confirms the *same* VAT ID is allowed across two different tenants, since the constraint is per-tenant)
- Update succeeds, 403 when targeting the walk-in customer, 404 for a nonexistent/cross-tenant id
- Deactivate/reactivate round-trip via `PATCH { isActive }`
- 401 on every route when unauthenticated

No new UI test tooling is introduced — this plan's frontend is verified via manual browser testing during implementation (matching how the design system plan's pages were verified), not automated component tests, consistent with the MVP spec's stated testing posture (VAT/total math and tenant isolation are the two things tested regardless of time pressure; broad UI test coverage was explicitly not committed to).

## 7. What this spec does not cover

Autocomplete/typeahead search for picking a customer while building a Sales Receipt — that's part of the Sales Receipt screen's own spec when that cycle starts, not this one. The auto-create-customer-from-a-new-VAT-ID-on-receipt-save behavior mentioned in the MVP spec is also Sales Receipt's concern, not Customers'. This spec is CRUD + the list screen only.
