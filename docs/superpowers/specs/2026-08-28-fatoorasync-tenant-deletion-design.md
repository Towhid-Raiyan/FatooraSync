# FatooraSync — Tenant Deletion with Export Archival — Design Spec

**Status:** Approved
**Last updated:** 2026-08-28

## 1. Purpose

The agency admin panel has a Suspend action (blocks login, stops billing) but no way to actually remove a churned client's data. Every product, customer, receipt, and quotation a tenant ever created stays in the live database forever, with no path to reclaim that space. At the same time, receipts are immutable, ZATCA-readiness-oriented tax records, and Saudi VAT rules require a business to retain its invoices for a multi-year window (baseline ~6 years) regardless of what software generated them — so a plain hard delete is a real legal risk for the client, not just a data-loss inconvenience for the agency.

This spec adds a **Delete Client** action that is safe on both fronts: it captures a complete, durable, downloadable archive of everything the tenant ever created *before* removing anything from Postgres, and it leaves a permanent, tiny record behind — a tombstone — so the agency's own admin panel never loses the ability to say "yes, we had that client," even though their live data is gone.

## 2. Scope

**In scope:**
- A `TenantArchive` tombstone record, created for every deleted tenant, that survives independently of the `Tenant` row.
- A full export of a tenant's data (structured JSON + rendered PDFs for every receipt/quotation) uploaded to Vercel Blob storage before deletion.
- Cascading deletes (`onDelete: Cascade`) added to every tenant-scoped relation, so deleting a `Tenant` row cleanly removes everything under it in one transaction.
- A strict, ordered delete flow: export → verify → tombstone → delete. Any failure before the final step leaves the tenant's data completely untouched.
- Admin UI: a "Delete Client" action on the tenant detail page, a typed-confirmation dialog stricter than the existing `DeleteConfirmDialog`, a "Deleted" view alongside the active tenant list, and a tombstone detail view with a "Download archive" link.
- A VAT-number match check on new-tenant creation, surfacing a link to a matching tombstone if the VAT number belonged to a previously deleted client.
- Restricting the action to the `CTO` agency role (not `DEVELOPER`).

**Explicitly out of scope / deliberately deferred:**
- **Restoring a deleted tenant's data.** Rejoining is handled as a brand-new tenant (fresh ID, fresh counters), not a restore — see §4.4 for the reasoning. No import/restore pipeline is built.
- **Re-importing just the catalog (products/customers) from an old archive into a new tenant.** A reasonable v2 convenience, not needed for this feature to be safe or complete. Not built now.
- **A grace period / soft-delete-then-purge-later window.** The delete is immediate once confirmed (after the export succeeds) — no scheduled job, no "recycle bin" with a timer. The archive itself already serves as the safety net; a second delay mechanism would add complexity without adding real safety.
- **Deleting individual pieces of a tenant's data short of the whole tenant.** This feature is whole-tenant-or-nothing. Partial deletion (e.g., "just remove old receipts") is a different, unrelated feature.

## 3. Data model

```prisma
model TenantArchive {
  id                     String   @id @default(uuid())
  // Deliberately NOT a foreign key to Tenant -- this record must survive the
  // Tenant row (and everything under it) being deleted entirely.
  originalTenantId       String
  legalName              String
  tradeNameEn            String
  tradeNameAr            String?
  vatNumber              String
  crNumber               String?
  phone                  String?
  address                String?
  joinedAt               DateTime // the tenant's original createdAt
  deletedAt              DateTime @default(now())
  deletedByAgencyStaffId String
  deletedByAgencyStaff   AgencyStaff @relation(fields: [deletedByAgencyStaffId], references: [id])
  receiptCount           Int
  quotationCount         Int
  earliestDocumentAt     DateTime?
  latestDocumentAt       DateTime?
  archiveUrl             String   // Vercel Blob URL for the full export archive

  @@index([vatNumber])
}
```

Add the reverse relation to `AgencyStaff`:

```prisma
  tenantArchives TenantArchive[]
```

Every existing tenant-scoped relation (`Customer.tenant`, `Product.tenant`, `Document.tenant`, `DocumentLine.tenant`, `Supplier.tenant`, `StockMovement.tenant`, `PurchaseReceipt.tenant`, `PurchaseReceiptLine.tenant`, `NumberLease.tenant`, `Settings.tenant`, `User.tenant`) gets `onDelete: Cascade` added to its `@relation(...)` — e.g.:

```prisma
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
```

This is the only way `prisma.tenant.delete()` can succeed at all today: every one of these relations currently defaults to `Restrict`, so deleting a `Tenant` with any related row in any table fails outright with a foreign key violation. No other schema change is needed — this migration alone makes tenant deletion structurally possible.

## 4. Core mechanisms

### 4.1 Export contents

One archive per deleted tenant, a single zip uploaded to Vercel Blob:

- `manifest.json` — the same identity/summary fields as the `TenantArchive` row, plus a row count per table (customers, products, suppliers, documents by type, purchase receipts, stock movements).
- `data.json` — a full structured dump of every tenant-scoped row, exactly as stored (not reformatted), for programmatic re-inspection or audit.
- `receipts/{number}.pdf` and `quotations/{number}.pdf` — every `Document` rendered via the **existing** PDF generation code this app already uses for live receipt/quotation downloads (`@react-pdf/renderer`, the same templates). This is the part that actually matters if the client or a ZATCA audit needs to see what an old invoice looked like — the JSON dump alone isn't a substitute for the real printed document.

### 4.2 Delete flow (strict ordering, all server-side, one request)

1. CTO clicks **Delete Client** on the tenant detail page (`/admin/tenants/[id]`).
2. Confirmation dialog (§5) shows counts and a retention-window warning, requires typing the tenant's trade name, and only then allows confirming.
3. On confirm, the server:
   a. Builds the export (data dump + rendered PDFs) inside a zip, entirely in memory/temp — no partial writes to Blob until the whole zip is assembled.
   b. Uploads the zip to Vercel Blob and receives back a URL.
   c. **Verifies** the upload succeeded (a follow-up existence/size check against the returned URL — not just trusting a 200 from the upload call).
   d. Creates the `TenantArchive` row with that URL and the summary fields.
   e. Deletes the `Tenant` row (cascades through everything under it in one transaction).
4. If step (a), (b), or (c) fails, the whole operation aborts: no `TenantArchive` row is created, the `Tenant` and all its data are completely untouched, and the CTO sees a clear error. Nothing is ever deleted without a confirmed, verified export already sitting in Blob storage first.

### 4.3 VAT-number rejoin detection

On the existing "Add New Tenant" flow (`/admin/tenants/new`), after the VAT number is entered, check it against `TenantArchive.vatNumber`. If a match exists, show a non-blocking notice: "This VAT number belonged to a previously deleted client (deleted `<date>`) — view archive" linking to the tombstone detail view. This costs one extra query and a UI notice; it does not change the new-tenant creation flow itself in any other way.

### 4.4 Why rejoining is a fresh tenant, not a restore

A returning client gets a normal new-tenant onboarding — new `Tenant` row, fresh `id`, counters starting at 1, exactly like any first-time client. Their old data stays exactly where it is: in the archive, downloadable, not live. This is deliberate, not a shortcut:

- It's consistent with how this project already reasons about ZATCA readiness (see the domain-decisions memory on switching from another POS provider): each onboarding is its own independent unit with its own counter and hash chain. A fresh start on rejoin is not a compliance problem, it's the expected shape.
- A real restore (reconstructing every row from the export, remapping every foreign key so IDs don't collide with anything created since, deciding whether already-immutable historical receipts should somehow become live documents again in a new numbering sequence) is a substantially larger and riskier feature than deletion itself. It is not needed for this feature to be complete or safe.
- Old, already-closed-out receipts staying archived rather than being reactivated into a new live sequence is the correct behavior, not a limitation — a receipt that was already immutable and done shouldn't come back to life next to newly numbered ones.

## 5. Admin UI

- **Delete action**: a distinct, visually serious button on `/admin/tenants/[id]`, separate from the existing billing/suspend controls.
- **Confirmation dialog**: new component, stricter than the existing `DeleteConfirmDialog` (`src/components/ui/delete-confirm-dialog.tsx`, which has no typed-confirmation step). Shows: tenant name, counts of what will be removed (receipts, quotations, customers, products), and a retention-window warning if the tenant's most recent document is within ~6 years of today. The warning is informational only — it never blocks or additionally gates the action; the same typed-name confirmation is the only requirement to proceed either way. This is a deliberate choice: the software surfaces the risk, the CTO makes the call, since it's the client's legal obligation to weigh, not something this app enforces on their behalf. The confirm button stays disabled until the CTO types the tenant's exact trade name into a field.
- **Deleted tenants view**: a second tab/filter on `/admin/tenants` listing `TenantArchive` rows (name, joined date, deleted date, receipt-count summary), visually distinct from the active tenant list.
- **Tombstone detail view**: clicking a deleted-tenant row shows the identity snapshot and a "Download archive" button that serves the Blob URL directly.

## 6. API

- `POST /api/admin/tenants/[id]/delete` — new. Executes the full flow in §4.2. CTO-role only (see §7). Returns the created `TenantArchive` id on success, or a clear error with nothing changed on failure.
- `GET /api/admin/tenants/archived` — new. Lists `TenantArchive` rows for the "Deleted" admin view.
- `GET /api/admin/tenants/archived/[id]` — new. Returns one tombstone's full detail, including `archiveUrl`.
- Existing `/api/admin/tenants/new` (or equivalent create endpoint) gains the VAT-match check from §4.3 — additive, no change to its existing behavior when there's no match.

## 7. Access control

Restricted to `AgencyStaffRole.CTO`. The role field already exists on `AgencyStaff` but isn't enforced anywhere yet — this is the first place it becomes a real gate, not just a label. A `DEVELOPER`-role staff member can view tenants and (per existing behavior) edit billing status, but cannot see or trigger the Delete action at all.

## 8. Testing

- Unit/integration tests for the delete route: full happy path (export uploads, tombstone created, tenant and all children actually gone from every table), and each failure-injection case (export build fails, Blob upload fails, verification fails) confirming the tenant and all its data are provably untouched afterward.
- A test confirming the cascade actually removes every tenant-scoped table's rows, not just the ones directly tested — enumerate every table with a `tenantId` and assert zero rows remain post-delete.
- A test for the VAT-match notice: creating a tenant with a VAT number matching an existing `TenantArchive` surfaces the match; a non-matching VAT number does not.
- A test confirming a `DEVELOPER`-role staff member gets a 403 from the delete route.
- Manual verification: real delete against a disposable dev tenant, confirm the downloaded archive's PDFs actually match what the live receipts looked like before deletion.
