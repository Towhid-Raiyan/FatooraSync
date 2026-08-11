# FatooraSync — Receipt History Design

**Status:** Approved
**Last updated:** 2026-08-11

## 1. Why this exists

The sidebar has had a "History" item since the design system phase, visually present but not clickable (`href: null` in `NAV_ITEMS`) — a placeholder for a page that couldn't exist until Sales Receipt shipped. It now can. This cycle builds that page, scoped explicitly to **sales receipts only**: a searchable, paginated list of every receipt a tenant has issued, with a way to view one (the existing print page) and a way to download it as a PDF file directly.

The nav item is renamed from "History" to "Receipt History" as part of this cycle — not a cosmetic choice, but because a future cycle adds Quotation (already stubbed in the nav as "Quotations", itself still `href: null`) and that will need its own, separate history list. "History" was never going to scale to two document types under one label; naming it precisely now avoids a rename-and-reroute later.

## 2. Data model

No schema changes. Everything this page needs already exists on `Document` (`number`, `type`, `customerId`, `grandTotal`, `createdAt`) and the related `Customer` (`name`, `vatId`) — the same fields the print page already reads. This cycle is entirely new routes and UI over existing data.

## 3. Screen layout and route

New page at `/receipts` (`src/app/(app)/receipts/page.tsx`), consistent with `/receipts/new` and `/receipts/[id]/print` already living under that segment. The `NAV_ITEMS` entry changes from `{ label: "History", href: null }` to `{ label: "Receipt History", href: "/receipts" }`.

A single card: a toolbar (search input + two date inputs) above a table (Receipt #, Customer, Date, Total, Actions), with a footer row showing the total match count and Previous/Next pagination controls. This is the exact layout validated in the interactive mockup shown during design review — no changes requested.

## 4. Loading strategy: server-side pagination

Unlike the Customers and Products pages — bounded catalogs that fetch everything and filter client-side — a tenant's receipt history grows without bound for as long as the business operates. Fetching the entire history on every page visit gets slower over time and never recovers on its own. This page uses real pagination from the start: the server returns one page of rows at a time, and search/date-range filtering happen server-side too, not against an already-downloaded array.

Confirmed during design review (`docs/specs` review discussion, not a separate ticket): this was presented as an explicit choice against the fetch-all pattern the rest of the app currently uses, specifically because this page's data doesn't share the bounded-catalog property that makes fetch-all acceptable elsewhere.

## 5. `GET /api/receipts` — the list endpoint

Added to the existing `src/app/api/receipts/route.ts` (which currently only exports `POST`), following the same file-per-resource convention as `src/app/api/customers/route.ts`.

**Query parameters**, all optional:
- `page` — 1-indexed, defaults to `1`, clamped to `>= 1`.
- `search` — matched two ways, combined with `OR`:
  - If, after trimming and stripping a leading `#`, the string parses as a positive integer, it's matched **exactly** against `Document.number`. (Not a "contains" match — Postgres can't cheaply substring-match an `Int` column without a raw-SQL cast, and exact-match on a low-cardinality sequential number is the common case: a cashier reading a number off a printed slip types the whole thing.)
  - Always also matched as a case-insensitive **substring** against `Customer.name` and `Customer.vatId` via `contains`.
- `dateFrom` / `dateTo` — `YYYY-MM-DD`. Filtered against `createdAt` as an inclusive range: `dateFrom` at `00:00:00.000` through `dateTo` at `23:59:59.999`, so a receipt issued at any time on the end date is included, not excluded by an exact-midnight boundary.

**Not a parameter:** page size. Fixed at `10` server-side (a module constant), matching the reviewed mockup exactly — no client-configurable page size, since nothing in this design calls for one and an unbounded client-supplied page size would be a way to reintroduce the fetch-all performance problem this endpoint exists to avoid.

**Query shape:**
```ts
const where: Prisma.DocumentWhereInput = {
  tenantId,
  type: "SALES_RECEIPT",
  ...(dateFrom || dateTo ? { createdAt: { gte: startOfDay, lte: endOfDay } } : {}),
  ...(search ? {
    OR: [
      ...(parsedNumber !== null ? [{ number: parsedNumber }] : []),
      { customer: { name: { contains: search, mode: "insensitive" } } },
      { customer: { vatId: { contains: search, mode: "insensitive" } } },
    ],
  } : {}),
};

const [total, documents] = await Promise.all([
  txn.document.count({ where }),
  txn.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true, number: true, grandTotal: true, createdAt: true,
      customer: { select: { name: true, vatId: true } },
    },
  }),
]);
```
`type: "SALES_RECEIPT"` is explicit and permanent, not a stand-in for "no other type exists yet" — this endpoint is Receipt History specifically (§1); Quotation History gets its own endpoint when that cycle ships, not a `type` query param bolted onto this one.

Uses `withTenant()` (not a raw transaction) — this is a plain scoped read, none of the multi-statement-transaction reasoning that put `POST /api/receipts` outside `withTenant()` applies here.

**Response:** `{ receipts: SerializedReceiptRow[], total: number, page: number, pageSize: number }`, where each row is `{ id, number, customerName, customerVatId, createdAt, grandTotal }` — `grandTotal` serialized to a string (the established Decimal-across-the-RSC-boundary rule), `createdAt` as an ISO string. Deliberately thin: the list view never needs line items, so the query never fetches them.

**Errors:** 401 if unauthenticated. No other error paths — an out-of-range `page` just returns an empty `receipts` array with the real `total`, not a 400; a malformed `dateFrom`/`dateTo` is silently ignored (treated as not supplied) rather than rejected, since this is a read-only convenience filter, not a mutation where silently ignoring bad input would be dangerous.

## 6. `GET /api/receipts/[id]/pdf` — direct PDF download

New route at `src/app/api/receipts/[id]/pdf/route.ts`. Fetches the same data the print page fetches (`Document` with `lines` and `customer`, plus the `Tenant` row) via `withTenant`, builds the same QR data URL via the same `qrcode` package call already used in `print/page.tsx`, and renders it to a PDF buffer with `@react-pdf/renderer`'s `renderToBuffer`, returned as:

```ts
return new NextResponse(buffer, {
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="receipt-${document.number}.pdf"`,
  },
});
```

**Frontend integration is a plain link, not a fetch call.** The "Download" button in the history table is `<a href={`/api/receipts/${id}/pdf`}>Download</a>`. The browser's native download handling (triggered by `Content-Disposition: attachment`) carries the session cookie automatically on a same-origin navigation — no client-side blob/fetch plumbing needed.

**404 vs 401:** unauthenticated → 401. A `receiptId` that doesn't resolve to a `SALES_RECEIPT` document for this tenant (wrong id, another tenant's receipt, or a stray Quotation id once that type exists) → 404, via the same `findFirst`-returns-null pattern the print page already uses, not a distinguishing "belongs to someone else" message — same reasoning as the existing "one or more items are no longer available" line-item error: don't let an error message confirm or deny another tenant's data exists.

## 7. The PDF template and the Arabic-rendering risk

`src/lib/receipts/receipt-pdf.tsx` exports a `ReceiptPdfDocument` component built from `@react-pdf/renderer` primitives (`Document`, `Page`, `View`, `Text`, `Image`, `StyleSheet`) — **not** a reuse of the print page's HTML/JSX, which react-pdf can't render. This means the on-screen print layout and the downloaded PDF are two separately-maintained templates fed the same data (tenant, customer, lines, totals, QR image) — a deliberate tradeoff accepted during design review in exchange for avoiding a headless-Chrome dependency (§ design review: "@react-pdf/renderer" chosen over "Puppeteer renders the print page" specifically for that reason). If the receipt layout changes later, both templates need updating; there's no structural guard against them drifting apart, only care at edit time.

**The one real technical risk in this cycle:** the print page's Arabic text (tenant trade name, bilingual labels like "فاتورة ضريبية مبسطة / Simplified Tax Invoice") renders correctly in a browser because browsers handle right-to-left shaping and Arabic script contextual letterforms natively. `@react-pdf/renderer` does not do this for free — it needs an Arabic-capable font registered via `Font.register()`, and even with one registered, complex-script shaping (ligatures, letter-joining, RTL ordering) isn't guaranteed to render correctly without verification. This app already uses IBM Plex Sans Arabic for on-screen UI (`next/font/google` in `layout.tsx`), but `next/font` doesn't expose a plain font file path usable by react-pdf — so the implementation task includes vendoring the actual `.ttf` file (downloaded once, committed under `src/lib/receipts/fonts/`) and registering it explicitly for the PDF renderer, independent of how the on-screen font is loaded.

**This will be verified directly during implementation**, generating an actual PDF with real Arabic content and inspecting it, before this cycle is considered done — not assumed to work because the font is "the same one." If Arabic shaping turns out not to render acceptably with react-pdf even with the right font registered, that's a finding to bring back for a decision (e.g., simplifying the Arabic content in the PDF specifically), not something to silently work around.

## 8. Frontend: the history page

`src/app/(app)/receipts/page.tsx` — a thin Server Component that reads the tenant and default page load (page 1, no filters) the same way `products/page.tsx` and `customers/page.tsx` do, then hands off to a Client Component, `ReceiptHistoryClient`, which owns all pagination/search/date-filter state and re-fetches from `GET /api/receipts` on every change (matching the "Option B" mockup's behavior: a brief loading state on every filter change or page navigation, not an instant client-side re-filter).

**Table columns**, in order: Receipt # (`document.number`, unpadded — matching how the print page already displays it, not the mockup's cosmetic zero-padding, which was a mockup-only polish detail never part of the approved design), Customer (name, with VAT ID as a smaller line beneath when present — same two-line cell pattern already used in the Items table's Product column), Date (`createdAt`, date-only, no time — matching the reviewed mockup), Total (`grandTotal`, two decimals, "SAR" suffix), Actions (View | Download).

**View** is a plain `<Link href={`/receipts/${id}/print`}>` — the existing, unchanged print page. **Download** is the plain anchor described in §6.

**Search and date inputs** debounce lightly (e.g. 300ms) before triggering a re-fetch, so typing doesn't fire a request per keystroke — this is new to this page; the Customers/Products search boxes don't need it because they filter in-memory with no network round trip per keystroke.

**Empty states:** no receipts at all for the tenant → "No receipts yet — create your first one" (same tone as the Customers/Products empty states). A search/filter that matches nothing → "No matching receipts" with the current filters still shown, so the cashier can see what they searched for and adjust rather than wondering if the page is broken.

## 9. Validation & error handling

| Case | Behavior |
|---|---|
| Unauthenticated request to either route | 401 |
| `GET /api/receipts` with an out-of-range `page` | 200, empty `receipts` array, real `total` |
| `GET /api/receipts` with a malformed `dateFrom`/`dateTo` | 200, that filter silently ignored |
| `GET /api/receipts/[id]/pdf` for a nonexistent or cross-tenant id | 404 |
| `GET /api/receipts/[id]/pdf` for a `QUOTATION`-type document (once that type exists) | 404 — this route is receipt-specific, matching `type: "SALES_RECEIPT"` in its lookup the same way the list endpoint does |

## 10. Testing

`src/app/api/receipts/route.test.ts` gains `describe("GET /api/receipts")` coverage (same file, same real-database harness already used for `POST`): tenant isolation (a receipt from another tenant never appears, even when its customer's name/VAT ID happens to match the search term); pagination (page 1 and page 2 of a tenant with more than 10 receipts return disjoint, correctly-ordered slices, and `total` reflects the true count regardless of page); search by exact receipt number; search by customer name substring; search by VAT ID substring; a search term matching neither a number nor any customer returns an empty page with `total: 0`; date-range filtering (a receipt just inside the range is included, one day outside is excluded on both ends); default sort is newest-first; 401 unauthenticated.

`src/app/api/receipts/[id]/pdf/route.test.ts` (new file): a valid receipt id returns 200 with `Content-Type: application/pdf` and a non-empty body; a cross-tenant id returns 404; a nonexistent id returns 404; 401 unauthenticated. Byte-level PDF content is not asserted — validating an actual PDF's rendered content is a job for manual verification (§7), not an automated test; the test's job is confirming the route's contract (status, headers, that *something* was generated), not the renderer's fidelity.

No new tests for the frontend beyond what manual browser verification during implementation covers (search, date range, pagination controls, View, Download, empty states) — consistent with how every prior cycle in this project has handled frontend testing.

## 11. What this spec does not cover

Quotation History (explicitly deferred to whenever the Quotation cycle ships — this spec's `type: "SALES_RECEIPT"` scoping is permanent, not a placeholder). Editing, voiding, or reissuing a past receipt (receipts remain immutable, per the original Sales Receipt spec — this page is read-only). CSV/Excel export of the history list. Any change to the print page itself. Credit notes or returns (already out of scope per the original MVP requirements review).
