# FatooraSync — Sales Receipt Design

**Status:** Approved
**Last updated:** 2026-08-10

**Revision note:** the original version of this spec had the Customer section toggle between "pick an existing customer" (search + selected-customer card) and "add a new customer" (a separate editable form). That's been replaced: the Customer section is now always a single flat five-field form (Name / VAT ID / CR Number / Phone / Address), with independent autocomplete suggestions on the Name and VAT ID inputs — selecting a suggestion fills all five fields from the matched record. The save request now carries a plain `customer: { name, vatId, crNumber, phone, address }` draft instead of `customerId`/`newCustomer`; the server resolves it by VAT ID (find-or-create), falling back to the tenant's Walk-in Customer when name or VAT ID (or both) is missing — see the revised §4 and §8. The Items section also gains a per-line flat-SAR **Discount** field, applied before VAT — see the revised §5 and §7. Every other section is unchanged.

## 1. Why this exists

The third of the phased feature builds on top of the design system foundation — Customers and Products shipped first. This cycle covers **Sales Receipt only**: creating a new receipt (customer + line items + notes), saving it as an immutable fiscal document, and printing it. Quotation (same engine, editable, no ZATCA fields) and Sales History (a searchable list of past receipts) are explicitly deferred to their own follow-up cycles — the MVP spec treats all three as related but separate scope items, and Sales Receipt alone is already the most complex screen in the product (the design system spec's own words, from its worked-example section).

This spec reuses the `Document`/`DocumentLine` schema, already in place and unchanged since the foundation plan, and the card-per-concern screen layout (Customer / Items / Notes / Totals) already approved in `docs/specs/2026-08-09-fatoorasync-design-system.md` §9.

## 2. Data model

Uses the existing `Document` and `DocumentLine` models (`prisma/schema.prisma`). This cycle only ever creates `Document` rows with `type: SALES_RECEIPT`. `DocumentLine` gains one additive field: `discount Decimal @default(0) @db.Decimal(12, 2)`, the flat SAR amount taken off that line before VAT (§7) — defaulted, so existing rows are unaffected.

**Migration:** `Tenant` gains two fields, updated together on every receipt save:
- `nextSalesReceiptNumber Int @default(1)` — the per-tenant sequential counter for `Document.number` when `type = SALES_RECEIPT`. Named specifically (not a generic `nextInvoiceNumber`) because the MVP spec requires Sales Receipt and Quotation numbering to be separate, never-interleaved sequences — when Quotation ships later, it gets its own `nextQuotationNumber` field, additive, no rename needed here.
- `lastSalesReceiptHash String?` — the most recently issued receipt's `invoiceHash` for this tenant, used to chain the next one's `previousInvoiceHash` (see §5). `null` for a tenant that has never issued a sales receipt.

## 3. Screen layout (already approved, restated as binding)

Per the design system spec's §9 worked example: a **Customer card**, an **Items card**, a **Notes card**, and a sticky right-column **Totals card** — each visually distinct, no undifferentiated single form. Save & Print (primary) / Save (ghost) live only in the Totals card — the page's one location for primary actions.

## 4. Customer section

A single, always-visible five-field form: Name, VAT ID, CR Number, Phone, Address — no toggle between "existing" and "new" modes. Typing in the Name field filters the tenant's already-fetched customer list client-side (substring match on `name`) and shows a suggestion dropdown; typing in the VAT ID field does the same over `vatId`. Selecting a suggestion (from either field) fills all five fields from that customer record. Nothing is saved to the Customers table as the cashier types — resolution happens once, server-side, as part of the same save transaction as the receipt itself (§8), so an abandoned/never-saved receipt never leaves an orphan customer behind.

**Resolution rule (server-side, §8):** if both Name and VAT ID are filled, the customer is found-or-created by VAT ID (the stored record's fields win over anything freshly typed, if a match exists). If Name or VAT ID (or both) is empty, the receipt attaches to the tenant's Walk-in Customer instead, and whatever was typed is not persisted anywhere.

## 5. Items section

A search input (SKU/barcode/name, client-side over the tenant's already-fetched active-product list) finds catalog items as the cashier types or scans. Selecting a result appends a line row: #, SKU, Product name (with Unit shown alongside), Qty (defaults to `1`, editable), Unit Price, Discount (defaults to `0`, editable, a flat SAR amount), VAT, Total, and a delete action. Unit Price and VAT are **not** editable per line — the UI displays them read-only from the product's catalog values at the moment it's added, so the cashier sees a stable price while building the receipt. Discount *is* editable — it's the one line-level input beyond quantity.

**Trust boundary — the server, not the client, decides what actually gets saved.** The frontend's displayed Unit Price/VAT is only ever for responsive display. `POST /api/receipts` (§8) never accepts a client-supplied price, VAT rate, or product name for a line — the request body carries only `productId` and `quantity` per line; the server re-reads each product's current `nameEn`/`unitPrice`/`vatRate` from the database, inside the same transaction that creates the receipt, and *that* server-read value is what gets snapshotted into `DocumentLine`. This matters for a fiscal document: trusting client-supplied financial figures would let a modified request forge a receipt's totals. In the near-universal case where nothing changed between adding the line and saving (seconds to minutes later), the server's fresh read matches what the cashier saw exactly; in the rare case a product's price changed mid-sale in another tab, the server's read is the more correct value to save anyway, not a bug.

**No catalog match found:** a "+ New Product" option opens a quick-create modal — the same field set as the Products page's Add dialog (Name EN/AR, Barcode, Unit, Unit Price, VAT override toggle, Quantity), minus SKU (system-generated, same as the Products section). Creating a product there adds it to the tenant's catalog via the existing `POST /api/products` route and immediately appends it as a line on the current receipt — no separate trip to the Products page needed mid-sale.

**Stock is not blocking.** If a line's quantity exceeds the product's current `quantity`, the row shows a small non-blocking "exceeds stock" flag — consistent with `Product.quantity` being a plain, untracked counter rather than real inventory control (per the MVP spec's explicit framing), and with keeping checkout fast rather than gating a sale on a number that might just be stale.

## 6. Notes section

A plain, optional textarea. Stored verbatim on `Document.notes`.

## 7. Totals & VAT calculation

Each line's VAT is computed and rounded to 2 decimals independently: `rawSubtotal = round(unitPrice × quantity, 2)`, `lineSubtotal = round(rawSubtotal − discount, 2)`, `lineVat = round(lineSubtotal × vatRate / 100, 2)`, `lineTotal = lineSubtotal + lineVat`. Discount is a flat SAR amount taken off the line **before** VAT is computed, so VAT is charged on the post-discount amount — standard tax practice. The document's `subtotal`/`vatTotal`/`grandTotal` are sums of the already-rounded line values, not a recomputation from re-rounded aggregates — this is the standard approach for keeping the printed line items and the printed total in agreement to the cent, avoiding the "lines don't quite add up" complaint that recomputing from an unrounded aggregate can produce.

Recalculated live in the browser on every line/quantity change, so the Totals card always reflects the current draft before saving.

## 8. Save: the atomic transaction

`POST /api/receipts` is the only mutation this cycle needs (no `PATCH`, no `DELETE` — receipts are immutable once saved, per the MVP spec).

**This route uses a raw `prisma.$transaction(...)`, not `withTenant()`.** Every other tenant-scoped route in the codebase goes through `withTenant()`'s Prisma Client Extension, which auto-injects `tenantId`. But this is the first route that needs a genuine multi-statement transaction, and Prisma's documented behavior for whether a client extension's query hooks are inherited by the callback client inside `$transaction()` is exactly the kind of thing not worth staking tenant isolation on without direct proof. Rather than requiring an implementer to empirically verify an assumption before trusting it, the route sidesteps the question entirely: every read inside the transaction explicitly filters by `tenantId` (via `findFirst`, since `findUnique` can't take a compound non-unique-index `where`), and every write explicitly stamps `tenantId`. This mirrors the exact reasoning `seed-tenant.ts` already uses for the one other place in the codebase that reaches for `prisma.$transaction` directly instead of `withTenant()` — see that file's own comment. `Tenant` itself was never intercepted by the extension in the first place (it's outside `TENANT_SCOPED_MODELS`), so its two `update` calls below were always explicit by construction.

The request body carries `{ customer: { name, vatId, crNumber?, phone?, address? }, lines: [{ productId, quantity, discount? }], notes? }` — no line-level price/VAT/name fields (§5's trust-boundary note). Inside the transaction, in order:

1. **Resolve the customer.** If both `name` and `vatId` are non-empty (after trimming): `txn.customer.findFirst({ where: { tenantId, vatId } })` — if found, use that customer's id as-is (the stored record wins over anything freshly typed); if not found, `txn.customer.create({ data: { tenantId, name, vatId, crNumber, phone, address } })`. If `name` or `vatId` (or both) is empty: `txn.customer.findFirst({ where: { tenantId, isWalkIn: true } })` — the tenant's Walk-in Customer — and nothing from the draft is persisted.
2. **Resolve each line's product server-side**: for every `{ productId, quantity, discount }`, `txn.product.findFirst({ where: { id: productId, tenantId, isActive: true } })` — a `productId` from another tenant, or an inactive product, simply isn't found (400, see §12) — reject (400) if `discount` is negative or exceeds that line's `unitPrice × quantity`, then compute `lineSubtotal`/`lineVat`/`lineTotal` (§7) from *that* fresh read's `nameEn`/`unitPrice`/`vatRate` (falling back to `Settings.defaultVatRate` when the product's own `vatRate` is `null`) and the request's `discount`, never from anything else in the request body.
3. **Atomically consume the next receipt number and read the prior hash in one call**: `txn.tenant.update({ where: { id: tenantId }, data: { nextSalesReceiptNumber: { increment: 1 } }, select: { nextSalesReceiptNumber: true, lastSalesReceiptHash: true } })`. Because `lastSalesReceiptHash` isn't part of `data` in this call, the `select` returns its value as it stood *before* this update — a single atomic read-and-increment, no separate query, no race window. This `UPDATE` also takes a row lock on the `Tenant` row for the rest of the transaction, which is what actually makes the numbering gapless under concurrency: a second save request for the same tenant blocks here until the first transaction commits or rolls back, so two receipts can never be issued with the same number, and a save that fails partway through never leaves the counter incremented without a matching `Document` row, because the whole transaction rolls back together.
4. **Compute the hash chain** (§9) using the prior hash just read, and build the new `Document` row: `number` = the consumed value minus 1, `previousInvoiceHash` = the prior hash (or a fixed genesis value if this tenant's first receipt), `invoiceHash` = newly computed, `uuid` = generated, `qrCode` = the ZATCA Phase-1 QR payload (§10) built from the final totals, `tenantId` stamped explicitly.
5. **Create the `Document` and its `DocumentLine` rows** in one nested write — each line stores the server-read `productName`/`unitPrice`/`vatRate` from step 2, and each line's `tenantId` is stamped explicitly (nested writes are the one case where even `withTenant()`'s own extension requires this — a documented limitation, not new to this route).
6. **Decrement `Product.quantity`** for every line (`where: { id: productId }` — safe without repeating the tenant filter here, since `productId` was already tenant-verified in step 2 and never re-derived from client input), by that line's quantity (allowed to go negative, per §5).
7. **Write the new hash back**: `txn.tenant.update({ where: { id: tenantId }, data: { lastSalesReceiptHash: newHash } })`.

If any step throws, the whole transaction rolls back — nothing partially saves, no receipt number or hash is consumed by a failed attempt.

**Validation before the transaction opens:** at least one line item required (400 if empty); each line's `quantity > 0`; each line's `discount` (if present) must be `>= 0` (per-line discount-vs-subtotal validation happens inside the transaction, in step 2, once the product's real price is known). Every `productId` must resolve to an active product belonging to this tenant (400 otherwise — surfaced as a generic "one or more items are no longer available" rather than confirming/denying a specific id exists, so the error can't be used to probe another tenant's product ids). 401 if unauthenticated.

## 9. ZATCA-readiness hash chain (Phase 1, not real cryptographic signing)

`invoiceHash` is a SHA-256 hex digest over a deterministic concatenation of the receipt's core fields: `previousInvoiceHash + uuid + grandTotal + vatTotal + createdAt (ISO 8601)`. This is **not** ZATCA's real Phase-2 cryptographic stamp (which requires live ZATCA onboarding, explicitly out of MVP scope per the requirements review) — it's the internal tamper-evidence chain the MVP spec calls for now, structured so that Phase 2 can later replace the hash function and add real cryptographic signing without restructuring historical records or the chain relationship itself. A brand-new tenant's first-ever sales receipt uses a fixed genesis string (`"0"`) as its `previousInvoiceHash`, since there is no prior receipt to chain from.

Implemented as a pure, independently unit-tested function (`src/lib/zatca/hash-chain.ts`) — deterministic input in, deterministic hex string out, no I/O — so the chain logic can be verified without hitting the database.

## 10. ZATCA Phase-1 QR code

A Base64-encoded TLV (Tag-Length-Value) payload, the standard ZATCA Phase-1 simplified-invoice QR structure: each field is one byte for the tag, one byte for the UTF-8 byte-length of the value, then the UTF-8 value bytes, concatenated in tag order, then the whole buffer Base64-encoded.

| Tag | Field | Source |
|---|---|---|
| 1 | Seller name | `Tenant.legalName` |
| 2 | VAT registration number | `Tenant.vatNumber` |
| 3 | Timestamp | Document's `createdAt`, ISO 8601 |
| 4 | Invoice total (incl. VAT) | `Document.grandTotal` |
| 5 | VAT total | `Document.vatTotal` |

Implemented as a pure function (`src/lib/zatca/qr-payload.ts`) producing the Base64 TLV string — this is what gets stored in `Document.qrCode` and handed to the `qrcode` npm package (pure JS, no native/network dependency) to render an actual QR image on the print page. Pure local computation throughout, matching the MVP spec's explicit "no external ZATCA API dependency in Phase 1" decision.

## 11. Print route

`src/app/(app)/receipts/[id]/print/page.tsx` — a Server Component fetching the saved `Document` (with its lines and customer) directly via `withTenant`, rendered with `@media print` styling: bilingual (Arabic + English) layout regardless of the active UI language (per the MVP spec's explicit print-language rule), tenant header (legal name, VAT number, address), the line-item table, totals, and the QR code image rendered from `Document.qrCode`. "Save & Print" navigates here immediately after a successful save; "Save" alone returns to a fresh blank receipt without navigating away.

## 12. Validation & error handling

| Case | Behavior |
|---|---|
| No line items | 400; page shows "Add at least one item" inline, save blocked client-side too |
| A line's quantity `<= 0` | 400 |
| A line's `discount < 0` | 400 |
| A line's `discount` exceeds that line's `unitPrice × quantity` | 400, "Discount cannot exceed the item's subtotal" (checked server-side in §8 step 2, once the real price is known) |
| A line's `productId` doesn't resolve to an active product in this tenant | 400, generic "one or more items are no longer available" (§8) |
| Customer draft has name or VAT ID (or both) empty | not an error — falls back to the tenant's Walk-in Customer (§4) |
| Unauthenticated request | 401 |

## 13. Testing

`src/lib/zatca/hash-chain.test.ts` and `src/lib/zatca/qr-payload.test.ts` — pure unit tests, deterministic inputs and outputs, no database: hash chain produces the documented genesis value for a `null` previous hash, produces a different hash for different inputs, and the QR payload's TLV byte layout matches the documented tag/length/value structure exactly (this is explicitly one of the two things the MVP spec says must be tested "regardless of time pressure," alongside tenant isolation).

`src/app/api/receipts/route.test.ts`, following the same real-database harness as Customers/Products: tenant isolation (a receipt created under one tenant never appears in — and can never reference customers/products from — another tenant; a `productId` belonging to another tenant is rejected with 400, not silently accepted); the price/VAT trust boundary (§5/§8) — a request that sends a fabricated price/VAT/name alongside a valid `productId` still saves the *product's real catalog values*, proving the server never trusts client-supplied financial fields; sequential numbering (two receipts saved back to back get consecutive `number`s); hash chaining (the second receipt's `previousInvoiceHash` equals the first's `invoiceHash`); stock decrement (a product's `quantity` drops by exactly the line quantity after save, and is allowed to go negative); validation failures (empty line items, non-positive quantity, nonexistent/cross-tenant `productId`, cross-tenant customer id); 401 unauthenticated. No `PATCH`/`DELETE` test is needed since those routes don't exist — immutability is enforced by omission, not by a guard to test.

No new UI test tooling — the frontend (customer/item search, quick-create modal, live totals, save/save & print) is verified via manual browser testing during implementation, same as every prior cycle.

## 14. What this spec does not cover

Quotation (same engine, editable/deletable, no ZATCA fields, its own numbering sequence) and Sales History (a searchable list of past receipts) are both explicitly deferred to their own future cycles. Credit notes/returns, ZATCA Phase-2 live API submission and real cryptographic signing, thermal ESC/POS printing, and any Inventory-module stock-movement ledger remain out of MVP scope per the original requirements review and are not addressed here.
