# FatooraSync — Stock & Inventory Management — Design Spec

**Status:** Approved
**Last updated:** 2026-08-23

## 1. Purpose

Today `Product.quantity` is a single number that gets silently overwritten: a sale decrements it with no record, and an Owner/Cashier editing the product form can type any new value with zero history of why it changed. There is no way to answer "why did this product's stock change," no tracked way to record new stock arriving, no distinction between a correction and a restock, and no low-stock warning.

This spec introduces a stock-movement ledger — every change to a product's stock (sale, restock, or adjustment) becomes its own permanent, attributed record — plus the UI to record restocks/adjustments and browse the history, a supplier directory, and per-product low-stock thresholds.

This was anticipated in the original MVP design: *"When Inventory is eventually built, it should introduce a stock-movement ledger that derives/reconciles the same `quantity` field rather than replacing it outright."* This spec is that ledger.

## 2. Scope

**In scope:**
- `Supplier` model + full CRUD (list, create), mirroring the existing `Customer` model/UI pattern.
- `StockMovement` model — an append-only ledger recording every stock change (`SALE`, `RESTOCK`, `ADJUSTMENT`), with quantity delta, resulting stock snapshot, and attribution (who, when).
- `Product.lowStockThreshold` — optional per-product threshold; a badge surfaces on Products and in Inventory when stock is at or below it.
- A shared `applyStockMovement()` function that is the *only* code path allowed to change `Product.quantity` — it writes the product update and the ledger row in one transaction. Receipt save is refactored to call this instead of its current raw `decrement`, so sales finally appear in the history too.
- New "Inventory" page (tenant nav): movement history table/card-list, filterable by product and type, with Restock and Adjust actions.
- Restock and Adjust modals, each with a live "current stock → resulting stock" preview.
- Full mobile/tablet responsiveness for every new screen, matching the conventions already shipped for the rest of the app (see §7).
- Full English/Arabic i18n, matching every other tenant-facing screen.

**Explicitly out of scope / deliberately deferred:**
- **Multi-location/branch stock** — single stock pool per shop only, confirmed with the user. No location dimension anywhere in the schema.
- **Purchase orders** — Restock records stock that has *already arrived*, not a pre-arrival ordering workflow.
- **Stock reversal from credit notes** — receipts are immutable and corrections go through credit notes, but that document type doesn't exist yet (separate, already-known gap). When it ships, it can add a movement type reusing this same ledger — no schema rework needed now.
- **Cost-of-goods / valuation reporting** — `unitCost` is captured on restock so it exists in the data, but no COGS report is built in this pass.

## 3. Data model

```prisma
model Supplier {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  name      String
  phone     String?
  address   String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  stockMovements StockMovement[]

  @@index([tenantId])
}

enum StockMovementType {
  SALE
  RESTOCK
  ADJUSTMENT
}

enum StockAdjustmentReason {
  DAMAGE
  LOSS_THEFT
  RECOUNT
  OTHER
}

model StockMovement {
  id              String                 @id @default(uuid())
  tenantId        String
  tenant          Tenant                 @relation(fields: [tenantId], references: [id])
  productId       String
  product         Product                @relation(fields: [productId], references: [id])
  type            StockMovementType
  quantityDelta   Decimal                @db.Decimal(12, 3) // signed: +restock, -sale, +/-adjustment
  quantityAfter   Decimal                @db.Decimal(12, 3) // snapshot, so history renders without replaying the ledger
  reason          StockAdjustmentReason? // ADJUSTMENT only
  note            String?
  unitCost        Decimal?               @db.Decimal(12, 2) // RESTOCK only
  supplierId      String?
  supplier        Supplier?              @relation(fields: [supplierId], references: [id])
  documentId      String?                // SALE only — the receipt that caused it
  document        Document?              @relation(fields: [documentId], references: [id])
  createdByUserId String
  createdByUser   User                   @relation(fields: [createdByUserId], references: [id])
  createdAt       DateTime               @default(now())

  @@index([tenantId, productId])
  @@index([tenantId, createdAt])
}
```

`Product` gains one field: `lowStockThreshold Decimal? @db.Decimal(12, 3)`. Null means no alert configured for that product (not every product needs one).

All new tables are tenant-scoped and added to `TENANT_SCOPED_MODELS` in `src/lib/db/tenant-context.ts`, same as every other tenant table — `withTenant()` remains the sole isolation mechanism (see the domain-decisions memory on why: Neon's `BYPASSRLS` makes Postgres RLS inert here).

## 4. Core mechanism

`Product.quantity` stays the fast, authoritative "current stock" number — every existing read path (receipt items, product list, low-stock checks) keeps working unchanged, no query rewritten to sum the ledger.

`src/lib/inventory/apply-stock-movement.ts` exports `applyStockMovement()`, taking a Prisma transaction client plus `{ tenantId, productId, type, quantityDelta, createdByUserId, reason?, note?, unitCost?, supplierId?, documentId? }`. It:
1. Reads the product's current quantity (within the transaction, so it's consistent with whatever else that transaction is doing).
2. Updates `Product.quantity` by `quantityDelta`.
3. Inserts the `StockMovement` row, including the resulting `quantityAfter`.

This is the **only** code path allowed to touch `Product.quantity`. `src/app/api/receipts/route.ts`'s existing `txn.product.update({ data: { quantity: { decrement: line.quantity } } })` loop is replaced with a call to `applyStockMovement()` per line (`type: "SALE"`, `documentId` set to the new receipt's id, `createdByUserId` from the session) — same transaction, same atomicity, but now every sale leaves a ledger row.

## 5. API

- `GET /api/inventory/movements?productId=&type=` — list, tenant-scoped, filterable. Any signed-in tenant user (Owner or Cashier) can view — same visibility as the Products list today.
- `POST /api/inventory/movements` — body `{ productId, type: "RESTOCK" | "ADJUSTMENT", quantity, unitCost?, supplierId?, reason?, note? }` (`SALE` movements are never created through this endpoint — only internally by receipt save). Guarded by `assertCanManageCatalog(tenantId, role)` — the exact guard Products already uses, so this automatically follows the Owner's existing "Cashier can manage catalog" toggle with no new Settings field. Validates: `RESTOCK` requires a positive quantity; `ADJUSTMENT` requires a `reason`, and requires `note` specifically when `reason` is `OTHER`.
- `GET /api/suppliers` / `POST /api/suppliers` and `PATCH /api/suppliers/[id]` — mirrors `src/app/api/customers/route.ts` structurally (list/search, create, edit, deactivate via `isActive`).

## 6. Navigation & UI

- New **"Inventory"** entry in `NAV_ITEMS` (`src/components/shell/nav-items.ts`), between Customers and Receipt History — not `ownerOnly`, since Cashiers can at least view it (write actions self-gate via the same permission the API enforces).
- **Inventory page**: a low-stock banner (count + jump-to-filter, only rendered when at least one product is at/below its threshold), a filter toolbar (type dropdown + product search), and the movement history — desktop table / mobile card-list per §7. "Restock" (primary) and "Adjust stock" (outline) buttons open their respective modals; both hide if the current user can't manage the catalog.
- **Restock modal**: product picker, quantity, optional unit cost, optional supplier picker (with quick-create, matching how Products already quick-creates from the receipt screen), optional note, live stock-after preview.
- **Adjust modal**: product picker, reason dropdown, quantity delta (signed), note (required only when reason is "Other"), live stock-after preview.
- **Products page**: a small low-stock badge next to any product at/below its threshold — same signal as Inventory's banner, surfaced where an Owner is already looking.
- **Suppliers page**: list + create, structurally identical to the Customers page.

## 7. Mobile & tablet responsiveness

Follows the conventions already shipped for the rest of the app (mobile responsive redesign, 2026-08-18) exactly — no new breakpoint philosophy introduced:

- Shell (nav) responsiveness is already handled app-wide by the existing `xl:` sidebar/drawer split — nothing new needed here beyond adding the nav item.
- The movement history and Suppliers list both get the established `hidden md:block` table / `md:hidden` card-list split (same shape as Customers/Products).
- Restock/Adjust modals use the existing centered `Dialog` primitive (already mobile-safe — see the print-modal and product-form-dialog fixes from the earlier responsive pass), with any multi-column field grid gated `grid-cols-1 sm:grid-cols-2`.
- Low-stock banner and badges use `flex-wrap`/stacking so they never force horizontal scroll at 375px (iPhone 12 Pro) or 1024px (iPad Pro portrait) — same test standard as prior responsive work.

## 8. i18n

Every new UI string goes through the existing `dict`/`useLocale()` system (`dictionary.types.ts` / `en.ts` / `ar.ts`), matching every other tenant-facing screen — this feature is not admin-panel-style plain English. Movement types, adjustment reasons, and field labels all get dictionary keys rather than hardcoded strings.

## 9. Testing

TDD throughout, matching existing project convention: `apply-stock-movement.test.ts` (unit), route tests for `/api/inventory/movements` and `/api/suppliers` (mirroring `route.test.ts` patterns already in the codebase — auth/permission checks, validation, the actual DB effect), and the receipt-save route's existing tests updated to assert a `StockMovement` row is written alongside the `Product.quantity` decrement.
