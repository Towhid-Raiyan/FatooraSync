# FatooraSync — Print Format (Thermal / A4) Design

## 1. Why this exists

Every printed/downloaded document (Sales Receipt, Quotation) currently uses one fixed layout: an A6-sized, single-page, thermal-POS-style design. That's right for supermarkets/grocery shops printing on a receipt roll, but wrong for other businesses that print on A4 paper and expect a conventional multi-page invoice layout. This feature adds a second, A4-sized document design and a per-tenant setting to choose which one prints — without changing the existing thermal design at all.

## 2. Scope

Applies to **both** Sales Receipt and Quotation, driven by **one shared tenant-wide setting**. It is purely additive:

- The existing thermal print pages, PDF templates, and their tests are untouched.
- No changes to any save/list API, ZATCA hash-chain logic, or QR generation logic — this is a presentation-layer feature. A receipt's underlying `qrCode`/`invoiceHash` data is identical regardless of which paper format renders it; a quotation still never has QR data, in either format.

## 3. Data model

Two additions, both backward-compatible defaults so every existing tenant keeps behaving exactly as today.

```prisma
enum PrintFormat {
  THERMAL
  A4
}

model Tenant {
  // ...existing fields...
  phone String?
}

model Settings {
  // ...existing fields...
  printFormat PrintFormat @default(THERMAL)
}
```

`phone` lives on `Tenant` (alongside `legalName`, `tradeNameEn/Ar`, `vatNumber`, `crNumber`, `address` — the same "business profile" facts), not `Settings` (which holds preferences like `defaultVatRate`/`language`). `printFormat` lives on `Settings` since it's exactly that kind of preference, and it already covers both document types by design — no per-document-type override.

## 4. Settings page and API

Today's `GET`/`PATCH /api/settings` only reads/writes `Settings.defaultVatRate` and `Settings.language`. This extends the same endpoint (no new route) to also read/write `Tenant.phone` and `Settings.printFormat` in one transaction:

- `GET /api/settings` response gains `phone` (from `Tenant`) and `printFormat`.
- `PATCH /api/settings` accepts `phone` (optional string, trimmed; empty string clears it to `null`) and `printFormat` (`"THERMAL"` or `"A4"`, 400 on anything else).

The Settings page (`src/app/(app)/settings/page.tsx`) gains two fields: a "Business Phone" text input and a "Print Format" select (Thermal / A4), alongside the existing VAT rate and language fields.

## 5. Where the format choice is read

Every print/PDF route already loads the tenant's `Settings` row or can cheaply add that read. Each one branches on `settings.printFormat`:

- `GET /receipts/[id]/print` and `GET /quotations/[id]/print` (browser pages) — render the existing thermal component when `THERMAL`, a new A4 component when `A4`.
- `GET /api/receipts/[id]/pdf` and `GET /api/quotations/[id]/pdf` — render the existing `ReceiptPdfDocument`/`QuotationPdfDocument` when `THERMAL`, new A4 PDF template components when `A4`.

Same URLs, same routes, same auth/tenant-isolation/404 rules as today — only the rendered component changes.

## 6. The A4 design

Bilingual, same spirit as the thermal design (Arabic tenant/customer names shown, dual-language field labels), styled per the approved mockups from this session:

- **Fonts:** "Prata" (serif, via Google Fonts) for the large document-title heading (`INVOICE` for Sales Receipt, `QUOTATION` for Quotation — English word, no Arabic parenthetical, matching the approved mockup). "Inter" (via Google Fonts) for everything else. For the browser print page, both load via `next/font/google` (Next.js handles self-hosting automatically). For the PDF template, both are registered from real `.ttf` files shipped by `@expo-google-fonts/prata` and `@expo-google-fonts/inter` (same vendoring pattern already used for the Arabic font in the thermal PDF template — confirmed via `npm pack --dry-run` that both packages ship real TTFs at `node_modules/@expo-google-fonts/prata/400Regular/Prata_400Regular.ttf` and `node_modules/@expo-google-fonts/inter/{weight}/Inter_{weight}.ttf`; both are OFL-1.1 licensed, free to embed).
- **Business header block** (top-left, repeats on every page): Arabic trade name, English trade name, then VAT ID, CR No., Phone, Address — each its own line (VAT ID and CR No. were tried paired onto one line during mockup review and overflowed, so they're separate lines). Any of VAT ID / CR No. / Phone / Address that isn't set on the tenant is simply omitted — no empty label shown.
- **Document title block** (top-right, repeats on every page): the large Prata heading, document number, and timestamp.
- **"Billed To" block** (only on page 1): a 2-column grid — Name / VAT ID on one row, CR Number / Phone on the next, Address spanning both columns. Any customer field that's blank (most commonly VAT ID/CR Number/Phone/Address for a walk-in customer) is omitted entirely, down to just showing "Name" alone when that's all that's known.
- **Item table:** adds a leading `#` serial-number column (1-indexed across the whole document, not reset per page) — **A4 only**, the existing thermal item table is unchanged. Same conditional discount column as thermal (only shown when at least one line has a discount).
- **Totals, QR, Note, footer block** (only on the last page): Subtotal / VAT Total / Grand Total, the QR code image (**Sales Receipt only** — Quotation never renders this block element since it never has QR data), the note (sized for ~2 lines / ~40 words, longer text is truncated rather than breaking the layout), and a small centered "Powered By: FatooraSync" line at the very bottom.

## 7. Pagination

A pure, unit-tested function decides how many items land on each page — this is computed server-side (both for the browser print page and the PDF template), not left to organic browser reflow, because the layout rules ("no totals block on page 1 if it overflows", "no Billed To after page 1") require deliberate placement.

```ts
// src/lib/print-format/paginate-a4-items.ts
export const SINGLE_PAGE_MAX_ITEMS = 14;   // page 1 also carries Billed To + QR/note/totals/footer
export const FIRST_PAGE_MAX_ITEMS = 20;    // multi-page mode: page 1 has Billed To but NOT QR/note/totals
export const MIDDLE_PAGE_MAX_ITEMS = 26;   // no Billed To, no QR/note/totals -- just header + items
export const LAST_PAGE_MAX_ITEMS = 16;     // no Billed To, but DOES carry QR/note/totals/footer

export function paginateA4Items(itemCount: number): number[] {
  if (itemCount <= SINGLE_PAGE_MAX_ITEMS) return [itemCount];

  const pages: number[] = [];
  let remaining = itemCount;
  const firstPageCount = Math.min(remaining, FIRST_PAGE_MAX_ITEMS);
  pages.push(firstPageCount);
  remaining -= firstPageCount;

  while (remaining > LAST_PAGE_MAX_ITEMS) {
    const take = Math.min(remaining, MIDDLE_PAGE_MAX_ITEMS);
    pages.push(take);
    remaining -= take;
  }
  pages.push(remaining); // always <= LAST_PAGE_MAX_ITEMS here, may be 0
  return pages;
}
```

The return value is an ordered list of item-counts per page (e.g. `[14]` for a single page, `[20, 5]` for 25 items, `[20, 26, 9]` for 55 items). A page can legitimately end up with 0 items (e.g. exactly 15 items → `[15, 0]`) — that's correct: item 15 didn't fit within the single-page budget, so a second page exists purely to carry the totals/QR/note/footer.

These four constants were derived from real row-height/margin math against A4 dimensions, not guessed — but they're a first estimate, not a certainty. **Task 1 of the implementation plan must include an actual rendered check** (render a page with exactly `SINGLE_PAGE_MAX_ITEMS` and `SINGLE_PAGE_MAX_ITEMS + 1` items, in the browser and in a generated PDF, and visually confirm nothing overflows/collides) before these constants are treated as final — same discipline as the Arabic-rendering check done for the thermal PDF template. If real rendering shows the numbers are off, they're a one-line constant change, not a structural rewrite, since the whole layout is driven by them.

Both `receipt-pdf-a4.tsx`/`quotation-pdf-a4.tsx` (multiple `<Page>` elements, one per array entry) and the two browser A4 print components (one `.a4-page` block per array entry, `break-after: page` in CSS so browser printing produces correct physical pages) consume this same function — it's the single source of truth for "how many items on which page," shared between both document types and both output formats.

## 8. Validation & error handling

No new validation beyond what's noted in §4 (`printFormat` must be exactly `"THERMAL"` or `"A4"`). Everything else (401/404 rules on the print/PDF routes, tenant isolation, Decimal serialization) is unchanged from the existing thermal routes — the branch only picks a different render target after all the existing checks already pass.

## 9. Testing

- `paginate-a4-items.test.ts` — unit tests on the pure function: boundary values at each constant (13/14/15, 19/20/21, 45/46/47, etc.), the `itemCount = 0` and very-large-count cases.
- `settings/route.test.ts` — extended for `phone`/`printFormat` read/write, including the new validation error case.
- Each new print/PDF route test file gets a case asserting the A4 branch renders when `printFormat: "A4"` is set (real PDF magic-bytes check, same pattern as the existing PDF route tests) and that setting `printFormat: "THERMAL"` still renders the original, byte-identical output (regression guard that this feature didn't disturb the shipped design).
- A manual rendered check (browser print preview + a generated PDF) at the two pagination boundaries described in §7, for both document types.

## 10. What this spec does not cover

- Per-document-type format override (e.g. thermal receipts but A4 quotations) — one shared setting only, per the approved decision.
- Any change to ZATCA hash-chain/QR generation logic, or to the existing thermal templates/routes/tests.
- A UI to preview the print format before saving the settings change.
- Editing any other Tenant business-profile field (legal name, trade names, VAT number, CR number, address) from the Settings page — only the new `phone` field is added there; the rest remain onboarding-only as they are today.
