# FatooraSync — Products Section Design

**Status:** Approved
**Last updated:** 2026-08-10

## 1. Why this exists

The second of three planned feature builds on top of the design system foundation — Customers shipped first, Products is next, Sales Receipt & Quotation last. This spec covers full CRUD for Products: API routes, list page, search, active/inactive toggle, add/edit dialog. It reuses every pattern the Customers section already established (list/search/toggle/dialog shape, error handling style, design system tokens) and calls out explicitly where Products' extra complexity — two independent uniqueness constraints, a per-product VAT override, a directly-editable stock counter — requires a different approach.

## 2. Data model

Uses the existing `Product` model (already in `prisma/schema.prisma`, unchanged): `tenantId`, `nameEn` (required), `nameAr` (nullable), `sku` (nullable, unique within a tenant), `barcode` (nullable, unique within a tenant), `unit` (enum: `PIECE | KG | BOX | CARTON | LITER`, defaults to `PIECE`), `unitPrice` (required decimal), `vatRate` (nullable decimal — `null` means "use the tenant's default VAT rate," a set value including `0` means an explicit override), `quantity` (decimal counter, defaults to `0`), `isActive` (soft-delete flag), `createdAt`. No migration needed.

Unlike Customer, there is no reserved/locked row equivalent to the Walk-in Customer — every product is a normal, fully editable, deactivatable record.

## 3. API — Route handlers under `src/app/api/products/`

Same Route Handler / `auth()` / `withTenant()` / manual-validation pattern as `/api/customers`.

- **`GET /api/products`** — returns all of the tenant's products, active and inactive together, sorted by `nameEn`. No query-param filtering; the frontend filters and sorts client-side. 401 if unauthenticated.
- **`POST /api/products`** — creates a product. Body: `{ nameEn, nameAr?, sku?, barcode?, unit?, unitPrice, vatRate?, quantity? }`. Validation: `nameEn` required (non-empty after trim); `unitPrice` required, must parse to a finite number `>= 0`; `quantity`, if present, must parse to a finite number `>= 0` (defaults to `0` if omitted); `vatRate`, if present, must parse to a finite number between `0` and `100`; `unit`, if present, must be one of the five enum values (defaults to `PIECE` if omitted). 401 if unauthenticated.
- **`PATCH /api/products/[id]`** — partial update. Body may include any of `{ nameEn, nameAr, sku, barcode, unit, unitPrice, vatRate, quantity, isActive }`, same validation as `POST` for whichever fields are present. 404 if the product doesn't exist or belongs to another tenant. 401 if unauthenticated.
- No `DELETE` endpoint. "Deletion" is always `PATCH { isActive: false }`, per the MVP spec's Product/Customer soft-delete parity.

**Uniqueness — a real difference from Customers' single-constraint pattern.** Product has *two* independent per-tenant unique constraints (`sku`, `barcode`), so a single "any P2002 means X" shortcut isn't precise enough to tell the user which field collided. Both `POST` and `PATCH` do a proactive lookup before writing — a `findFirst` for another product in the same tenant with a matching non-null `sku`, and a separate one for a matching non-null `barcode` — and return 409 with a message naming the specific field ("This SKU is already in use by another product" / "This barcode is already in use by another product"). As with Customer's `vatId`, Postgres allows any number of products with a `null` SKU or `null` barcode — the check only fires on a real value collision.

## 4. Frontend

**Page:** `src/app/(app)/products/page.tsx` — Server Component, fetches the full list via `withTenant` (same pattern as Home/Customers), hands it to `ProductsClient`.

**`ProductsClient`** (`src/components/products/products-client.tsx`): same toolbar/table/dialog shape as `CustomersClient` —

- **Toolbar:** search `Input` (live client-side filter matching `nameEn`, `nameAr`, `sku`, `barcode`, case-insensitive), a "Show inactive" `Checkbox`, and the page's one primary action, "+ Add Product" (`variant="primary"`, toolbar only, not duplicated in the empty state — the exact duplication bug found in the Customers final review is designed out from the start here).
- **Table** (inside a `Card`, same border/shadow treatment as Customers/Home/Settings): columns SKU (compact monospace, per the design system's line-item table pattern), Barcode, Name (shows `nameEn`, with `nameAr` beneath it in smaller muted text when present), Unit, Unit Price (right-aligned, numeric), VAT (a small badge — "Default" in a neutral tint when `vatRate` is `null`, or the explicit percentage in a badge when overridden), Quantity (right-aligned, numeric), Actions (Edit / Deactivate-Reactivate, same as Customers). Filtered *and sorted* client-side by `nameEn` from the full fetched list — sorting is implemented from the start (Customers' final review had to add this after the fact; this plan specifies it directly in Task 4 rather than leaving it for a fix round).
  - Inactive rows render muted (`opacity-50`), same as Customers.
- **Empty state:** if there are zero products, the table area is replaced with a centered "No products yet — add your first one" message — no second "+ Add Product" button, matching the corrected Customers pattern (the toolbar's button is never hidden, so a second one would duplicate the page's one primary action).

**Add/Edit modal** (`ProductFormDialog`, shadcn `Dialog`): a two-column layout inside the dialog (Products has more fields than Customers' single-column 5) —

- Row 1: Name (EN, required) / Name (AR, optional)
- Row 2: SKU / Barcode
- Row 3: Unit (a `<select>` of the five enum values — Piece, KG, Box, Carton, Liter — styled to match `Input`'s metrics, same fix already applied to Settings' language `<select>`) / Unit Price (required, numeric)
- Row 4: a "Use default VAT rate" `Checkbox`, checked by default; unchecking it reveals a VAT rate number input in the same row (this is the deliberate toggle+field pattern chosen over a plain optional number field, so exempt-at-0% reads as an intentional choice rather than an easy-to-miss blank)
- Row 5: Quantity (numeric, directly editable on both create and edit — there's no separate stock-adjustment tooling yet, so this is the only way to set initial stock or correct a miscount, matching the MVP spec's own reasoning for why the field exists at all)

Submitting calls `POST` (create) or `PATCH` (edit); on success, closes the dialog and updates the in-memory list; on failure, shows the server's error message inline near the top of the form. The dialog's submit handler wraps the fetch/response-handling in `try/catch/finally` from the start, so a network failure or unexpected error can never leave the Save button stuck disabled — the exact bug the Customers final review caught and fixed after the fact is designed out here directly.

**Deactivate/Reactivate row action:** same `PATCH { isActive }` call as Customers, with an inline error surface (a `role="alert"` message rendered between the toolbar and the table) if the request fails — again, built in from the start rather than left silent until a review catches it.

## 5. Validation & error handling

| Case | Behavior |
|---|---|
| Empty/whitespace-only `nameEn` | 400; dialog shows "English name is required" inline |
| Missing or negative `unitPrice` | 400; dialog shows "Unit price is required and must be zero or more" |
| Negative `quantity` | 400; dialog shows "Quantity must be zero or more" |
| VAT override enabled with an out-of-range rate (not 0–100) | 400; dialog shows "VAT rate must be between 0 and 100" |
| Duplicate SKU within the tenant | 409; dialog shows "This SKU is already in use by another product" |
| Duplicate barcode within the tenant | 409; dialog shows "This barcode is already in use by another product" |
| Unauthenticated request | 401 |
| Product not found / belongs to another tenant | 404 |

## 6. Testing

`src/app/api/products/route.test.ts` and `src/app/api/products/[id]/route.test.ts`, following the exact harness Customers established (`vi.mock` on `@/lib/auth/config`, real tenant + DB rows in `beforeAll`/cleaned in `afterAll`). Covers: tenant isolation on `GET` (a second tenant's product must never leak into the first tenant's list — the MVP spec's "single most important test in a multi-tenant system"); create success and validation failures (empty name, missing/negative price, negative quantity, out-of-range VAT); the SKU-conflict-within-a-tenant and barcode-conflict-within-a-tenant cases *both* (not just one, since they're independent constraints), plus confirming the same SKU/barcode is allowed across two different tenants and that multiple products with no SKU/no barcode are both allowed; update success, deactivate/reactivate round-trip, 404 for a nonexistent/cross-tenant id; 401 on every route when unauthenticated.

No new UI test tooling — frontend verified via manual browser testing during implementation, same as Customers and the design system plan.

## 7. What this spec does not cover

Barcode/SKU/name autocomplete for the future Sales Receipt line-item entry, and the "quick-create modal from the receipt screen" mentioned in the MVP spec — both belong to the Sales Receipt screen's own spec when that cycle starts. Stock movements/ledger, low-stock alerts, and any other Inventory-module behavior are explicitly out of MVP scope per the original requirements review and are not addressed here — `quantity` stays a plain, directly-editable counter.
