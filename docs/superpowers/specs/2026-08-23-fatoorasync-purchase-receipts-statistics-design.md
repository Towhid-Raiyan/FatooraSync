# FatooraSync — Purchase Receipts & VAT Statistics — Design Spec

**Status:** Built and shipped
**Last updated:** 2026-08-23

*Written retrospectively, after the feature shipped — the design itself was worked out conversationally with the user (a brainstorming Q&A pass, an interactive demo, then three rounds of live feedback after the first version shipped), not from a spec drafted up front. This records the decisions actually made, for the same reason every other feature in this table has one.*

## 1. Purpose

Restocking previously meant recording one product at a time via a single-product Restock dialog, with no way to capture what was actually received: a supplier's own invoice, several products in one delivery, or the VAT paid on that purchase. The user asked how industry practice handles this — the answer (purchase-invoice-based restocking, not one line at a time) became this feature.

It also closes a real reporting gap: a Saudi business must reconcile *incoming* VAT (on purchases) against *outgoing* VAT (on sales) for its quarterly ZATCA return, and until this feature the app only tracked the outgoing half.

## 2. Scope

**In scope:**
- `PurchaseReceipt` / `PurchaseReceiptLine` models — a structural twin of the Sales Receipt/Document pattern (own sequential number, one atomic save, per-line unit/quantity/cost/VAT).
- The Restock button on `/inventory` now opens a full Purchase Receipt modal (supplier, their receipt #, purchase date, cash/credit, and a multi-product line editor) instead of the old single-product form.
- Every purchase receipt line writes a `RESTOCK` `StockMovement` via the existing `applyStockMovement()`, linked back to the purchase receipt so the Inventory Track ledger shows "Purchase #N" instead of a bare supplier name.
- A new Inventory Track / Purchase Receipts toggle on `/inventory`, with the latter a paginated, searchable history + an on-screen-only detail modal (no print/PDF, unlike Sales Receipts).
- `Supplier` gained `vatId` / `crNumber`, surfaced on the Suppliers page and in the purchase receipt detail view.
- A new Owner-only `/statistics` page: incoming vs. outgoing VAT for a selected calendar quarter, a small hand-rolled SVG donut (no charting library added), and a net payable/refund figure.
- `DOZEN` added to the `Unit` enum, usable for regular Products too, not just purchase lines.
- Full mobile/tablet responsiveness and English/Arabic i18n, matching every other tenant-facing screen.

**Explicitly out of scope / deliberately deferred:**
- **Accounts payable** — Cash/Credit is just a label for v1; no aging, balance tracking, or payment recording behind it.
- **Purchase receipt print/PDF** — history "View" is an on-screen detail modal only, an explicit answer during brainstorming.
- **ZATCA submission** — Statistics is a reporting aid for the Owner to prepare their own quarterly return, not an integration with ZATCA's API.

## 3. Data model

```prisma
enum PaymentMethod {
  CASH
  CREDIT
}

model PurchaseReceipt {
  id                    String        @id @default(uuid())
  tenantId              String
  tenant                Tenant        @relation(fields: [tenantId], references: [id])
  number                Int
  supplierReceiptNumber String?
  supplierId            String
  supplier              Supplier      @relation(fields: [supplierId], references: [id])
  purchaseDate          DateTime
  paymentMethod         PaymentMethod
  subtotal              Decimal       @db.Decimal(12, 2)
  vatTotal              Decimal       @db.Decimal(12, 2)
  grandTotal            Decimal       @db.Decimal(12, 2)
  createdAt             DateTime      @default(now())

  lines          PurchaseReceiptLine[]
  stockMovements StockMovement[]

  @@unique([tenantId, number])
  @@index([tenantId, purchaseDate])
}

model PurchaseReceiptLine {
  id                String          @id @default(uuid())
  tenantId          String
  purchaseReceiptId String
  purchaseReceipt   PurchaseReceipt @relation(fields: [purchaseReceiptId], references: [id])
  productId         String
  product           Product         @relation(fields: [productId], references: [id])
  productName       String
  unit              Unit
  quantity          Decimal         @db.Decimal(12, 3)
  unitPrice         Decimal         @db.Decimal(12, 3)
  vatRate           Decimal         @db.Decimal(5, 2)
  lineSubtotal      Decimal         @db.Decimal(12, 2)
  lineVat           Decimal         @db.Decimal(12, 2)
  lineTotal         Decimal         @db.Decimal(12, 2)
}
```

`Tenant` gained `nextPurchaseReceiptNumber`. `Supplier` gained `vatId String?` / `crNumber String?`. `StockMovement` gained an optional `purchaseReceiptId`.

## 4. Line VAT is a direct amount, not a rate

The single biggest decision that changed shape after shipping: line VAT started as a percentage input (`vatRate`, matching the Sales Receipt line pattern), computed into a VAT amount via the shared `calculateLine()` helper. Two rounds of live feedback established the user wants to type the VAT *amount* itself, since that's what a supplier's paper invoice actually shows — not back-calculate it from a rate.

The API now accepts `vatAmount` per line and computes `lineVat` directly from it (`lineTotal = lineSubtotal + lineVat`), bypassing `calculateLine()`'s rate-based math entirely. The `vatRate` schema column stays (avoiding a migration) but is now a *derived*, informational value (`lineVat / lineSubtotal * 100`) — nothing reads it as input. This was deliberately decoupled from the product catalog's own sales `vatRate` from the start: purchase cost/VAT can differ from what the product sells at.

## 5. Modal sizing: a fixed-height content pane, not an unbounded card

The Purchase Receipt modal grows however many products are added, and the natural approach — let the modal's own height track its content — broke twice in practice: first the modal grew past the viewport in both directions (no `max-height` at all, so Save and the close button became unreachable), then after capping the height, the *empty* state was still shorter than the *populated* state, so adding the very first product visibly jumped the modal's size.

The fix that stuck: the product-list area is a **fixed-height** (not max-height) scrollable box, rendered at that size whether it holds zero or many lines — the "no products yet" placeholder lives inside the same box rather than replacing it with a shorter element. Only that box scrolls; supplier info, totals, and the footer stay in normal flow outside it, so the modal's overall height never changes as products are added or removed. `DialogContent` also carries a `max-h-[95vh] overflow-y-auto` safety net for the (still possible) case where a short real-world browser window can't fit even the constant-height layout — confirmed necessary in practice, since a dev-viewport height that looked fine still overflowed on the user's actual browser (chrome/taskbar eating more vertical space than a bare viewport height suggests).

## 6. Statistics: quarter aggregation and color coding

`src/lib/statistics/quarter-range.ts` computes UTC quarter boundaries from a year+quarter pair, defaulting to the current calendar quarter. Outgoing VAT sums `Document.vatTotal` where `type = SALES_RECEIPT` in range; incoming VAT sums `PurchaseReceipt.vatTotal` in range. Net payable is outgoing minus incoming — framed as a refund position (not a negative payable) when negative.

Color coding was a follow-up request, not part of the original design: the donut's outgoing slice and the net figure are both red when outgoing is bigger (money owed), green when incoming is bigger (refund position), matching how a business owner would want to scan the page at a glance.

## 7. Access

Purchase receipt writes are gated by the existing `assertCanManageCatalog` permission — same gate as the old single-product Restock. Statistics is Owner-only, mirroring Settings (`assertOwnerRole` at the API layer, a page-level `redirect("/")` for anyone else, filtered out of the nav via the existing `ownerOnly` flag on `NAV_ITEMS`).

## 8. Deployment

Migration `20260823123505_add_purchase_receipts` was applied to both the dev and production Neon databases (`prisma migrate deploy`, run with the `neondb_owner` role via `DIRECT_URL` — the `fatoorasync_app` runtime role has no `CREATE` on the schema and will fail the very first statement if used for the migration itself; this project's existing default-privileges setup then grants the new tables to `fatoorasync_app` automatically). Verified live via a throwaway tenant on both dev and production before considering the rollout complete, per this project's established practice for anything touching the database.
