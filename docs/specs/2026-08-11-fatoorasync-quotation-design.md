# FatooraSync — Quotation Design

## 1. Why this exists

Sales Receipts (`docs/specs/2026-08-10-fatoorasync-sales-receipt-design.md`) are ZATCA-readiness documents: hash-chained, QR-coded, and they decrement stock as a record of a completed sale. A Quotation is a non-binding price estimate given to a customer before a sale happens — it must look and behave like a receipt in every way that isn't about the sale actually having occurred.

This spec is written as a **delta** against two already-shipped, already-reviewed specs — the Sales Receipt design and the Receipt History design (`docs/specs/2026-08-11-fatoorasync-receipt-history-design.md`) — rather than re-deriving their shared behavior. Anything not called out below (validation rules, the customer find-or-create logic, the debounced search UI, pagination shape, print-page layout, PDF template layout) is unchanged from those specs; only the differences are documented here.

## 2. Data model

No new tables. `Document`/`DocumentLine` are reused with `type: "QUOTATION"` (the `DocumentType` enum already has this value; it has been unused until now). `@@unique([tenantId, type, number])` on `Document` means quotations get their own independent `#1, #2, ...` sequence, entirely separate from receipt numbers, with no extra modeling.

One schema change: add a counter to `Tenant`, mirroring `nextSalesReceiptNumber`:

```prisma
model Tenant {
  // ...existing fields...
  nextQuotationNumber Int @default(1)
}
```

No hash-chain or QR fields are used for quotations — `invoiceHash`, `previousInvoiceHash`, and `qrCode` are left `null` on every quotation `Document` row. `lastSalesReceiptHash` is untouched by quotation saves (it stays receipt-only).

## 3. Behavioral deltas from Sales Receipt's save transaction

`POST /api/quotations` (`src/app/api/quotations/route.ts`, new) reuses `POST /api/receipts`'s transaction shape (`src/app/api/receipts/route.ts:106-311`) — same settings read, same per-line trust boundary (server re-reads `productName`/`vatRate` fresh, `unitPrice` override is still the one client-trusted field), same customer find-or-create/walk-in-fallback logic, same `calculate-totals.ts` math (reused unchanged — it's pure VAT/discount arithmetic, nothing ZATCA-specific about it) — with these differences:

- Uses `nextQuotationNumber` instead of `nextSalesReceiptNumber` for the row-locked counter increment.
- `type: "QUOTATION"` on the created `Document`.
- **No stock decrement.** The receipt route's per-line `txn.product.update({ data: { quantity: { decrement: line.quantity } } } )` loop (`route.ts:298-303`) is omitted entirely — a quotation is an estimate, not a completed sale, so it must not affect inventory.
- No `computeInvoiceHash`/`GENESIS_HASH`, no `buildZatcaQrPayload`, no `lastSalesReceiptHash` update. `invoiceHash`, `previousInvoiceHash`, `qrCode` are simply omitted from the `create` call (left `null`/default).
- Same error handling: `ReceiptError`-style typed errors → their status code; Prisma `P2002` on the customer VAT-ID unique constraint → 409; validation messages identical in spirit ("Add at least one item", "Each item must have a positive quantity", etc.) with "receipt" language swapped for "quotation" where user-facing.

`GET /api/quotations` (same file) reuses `GET /api/receipts`'s pagination/search/date-range logic verbatim (`route.ts:320-...` — page size, exact-number-or-substring search across quotation number/customer name/VAT ID, inclusive date range with the UTC-boundary fix already in place), filtered to `type: "QUOTATION"`. Reuses the existing `PAGE_SIZE` constant from `src/lib/receipts/constants.ts` directly (page size is a product-wide UI decision, not receipt-specific — no need for a duplicate constant).

## 4. PDF export

`GET /api/quotations/[id]/pdf` (`src/app/api/quotations/[id]/pdf/route.tsx`, new) mirrors `GET /api/receipts/[id]/pdf` exactly: same auth → `findFirst` (scoped to `type: "QUOTATION"`) → 404-for-nonexistent/cross-tenant/wrong-type collapse → `Content-Disposition: attachment` → `renderToBuffer`. Two differences:

- `filename="quotation-${document.number}.pdf"` instead of `receipt-${document.number}.pdf`.
- Renders a new `QuotationPdfDocument` component (`src/lib/quotations/quotation-pdf.tsx`, new) instead of `ReceiptPdfDocument`.

`QuotationPdfDocument` is `receipt-pdf.tsx`'s `ReceiptPdfDocument` (`src/lib/receipts/receipt-pdf.tsx:83-151`) with:
- The `qrImageDataUrl` prop and its rendered `<Image>` block removed entirely — quotations never have a QR code, so there's no conditional to keep.
- The meta-row header text changed from `فاتورة ضريبية مبسطة / Simplified Tax Invoice #{document.number}` to `QUOTATION (عرض سعر) #{document.number}`.
- Everything else — fonts (same vendored `@expo-google-fonts/ibm-plex-sans-arabic` TTFs, same `Font.register` setup), styles, customer block, item table (including the conditional discount column), totals block, notes — copied unchanged.

## 5. Frontend: New Quotation

`src/app/(app)/quotations/new/page.tsx` (new) mirrors `src/app/(app)/receipts/new/page.tsx` exactly (same `withTenant` reads of active customers/products/settings, same Decimal-to-string serialization), rendering a new `QuotationForm` component (`src/components/quotations/quotation-form.tsx`, adapted from `src/components/receipts/receipt-form.tsx`) instead of `ReceiptForm`. The form and its `ItemsSection` (`src/components/quotations/items-section.tsx`, adapted from `src/components/receipts/items-section.tsx`) are visually and behaviorally identical to the receipt form — same grid layout, same editable price/total/VAT-amount columns, same Add Product flow — with only these changes:

- Submits to `POST /api/quotations` instead of `/api/receipts` (`receipt-form.tsx:144`).
- On success, redirects to `/quotations/${body.id}/print` instead of `/receipts/${body.id}/print` (`receipt-form.tsx:181`).
- Page/button copy: "New Quotation" / "Save Quotation" wherever the current form says "New Receipt" / "Save Receipt".

## 6. Frontend: print/view page

`src/app/(app)/quotations/[id]/print/page.tsx` (new) mirrors `src/app/(app)/receipts/[id]/print/page.tsx` exactly (same `withTenant` fetch scoped to `type: "QUOTATION"`, same `notFound()` on miss, same bilingual layout, same `PrintButton`), with two changes:

- The header line becomes `QUOTATION (عرض سعر) #{document.number}` (was `فاتورة ضريبية مبسطة / Simplified Tax Invoice #{document.number}`, `print/page.tsx:44`).
- The QR image block (`print/page.tsx:98-101`, gated on `document.qrCode`) is removed — `document.qrCode` is always `null` for a quotation, so the block would never render anyway, but the `QRCode.toDataURL` call and import are dropped too since they're dead code for this document type.

Everything else — trade name header, customer block, item table, totals, notes, print stylesheet — is copied unchanged.

## 7. Frontend: Quotation History

`src/app/(app)/quotations/page.tsx` + `src/components/quotations/quotation-history-client.tsx` (new) mirror the Receipt History page (`src/app/(app)/receipts/page.tsx` + `src/components/receipts/receipt-history-client.tsx`) exactly: same server-side pagination, same debounced search-by-number/customer-name/VAT-ID, same date-range filter, same table columns (Quotation #, Customer, Date, Total, Actions), same View (→ `/quotations/${id}/print`) and Download (→ `/api/quotations/${id}/pdf`) actions, same two empty states. Only the API base path (`/api/quotations`) and copy ("Quotation #" instead of "Receipt #", etc.) change.

## 8. Navigation

`src/components/shell/nav-items.ts` currently has a placeholder:

```ts
{ label: "Quotations", href: null },
```

The full array becomes:

```ts
export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "New Receipt", href: "/receipts/new" },
  { label: "New Quotation", href: "/quotations/new" },
  { label: "Products", href: "/products" },
  { label: "Customers", href: "/customers" },
  { label: "Receipt History", href: "/receipts" },
  { label: "Quotation History", href: "/quotations" },
  { label: "Settings", href: "/settings" },
];
```

i.e. the `Quotations` placeholder is replaced in place by `New Quotation`, and `Quotation History` is inserted directly after `Receipt History`.

## 9. Validation & error handling

Identical rules to Sales Receipt (`docs/specs/2026-08-10-fatoorasync-sales-receipt-design.md` §12) and Receipt History (`docs/specs/2026-08-11-fatoorasync-receipt-history-design.md` §9) — positive quantity, non-negative discount not exceeding the line subtotal, non-negative unit-price override, at least one line, 401 for unauthenticated requests, 404 (never 403) for nonexistent/cross-tenant/wrong-type documents on the print and PDF routes, out-of-range page returns 200 with an empty array. Nothing about these rules changes for quotations.

## 10. Testing

Same shape as the existing receipt test suites, adapted:
- `src/app/api/quotations/route.test.ts` — POST behavior (customer resolution, walk-in fallback, VAT-ID uniqueness conflict, validation errors, **no stock decrement** — this is the one behavior worth a dedicated assertion since it's the main functional difference from the receipt save) and GET behavior (pagination, search by number/name/VAT-ID including the full-15-digit-VAT-ID case, date range, tenant isolation), mirroring `src/app/api/receipts/route.test.ts`.
- `src/app/api/quotations/[id]/pdf/route.test.ts` — 401/404 matrix, successful PDF generation, mirroring `src/app/api/receipts/[id]/pdf/route.test.ts`.

Arabic-rendering is not re-verified from scratch for the PDF template — the font/shaping mechanism was already confirmed working for the near-identical receipt PDF template in the Receipt History cycle. It only needs a quick sanity check that the new static header string renders correctly, not a full re-investigation.

## 11. What this spec does not cover

- Converting a Quotation into a Sales Receipt (would need its own resolution rules — e.g. does it decrement stock only at that point, does it get a fresh receipt number — out of scope here).
- Editing or voiding a saved Quotation.
- Emailing or otherwise sharing a Quotation beyond the existing View/Download actions.
- Any change to the Sales Receipt or Receipt History features themselves — this is purely additive.
