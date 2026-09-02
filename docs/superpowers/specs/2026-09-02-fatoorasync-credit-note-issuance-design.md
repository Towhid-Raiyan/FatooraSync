# FatooraSync — Credit Note Issuance — Design Spec

**Status:** Approved
**Last updated:** 2026-09-02

## 1. Purpose

Receipts are immutable — once saved, a sale can never be edited or deleted (this was a deliberate decision; see the domain-decisions memory). When a customer returns goods or a receipt needs correcting, the only correct path is a separate document that reverses part or all of the original: a credit note. That document type doesn't exist yet — `DocumentType` has only `SALES_RECEIPT` and `QUOTATION` — even though the schema already has an unused `creditNoteOfDocumentId` self-relation on `Document` anticipating it, and the inventory-management spec explicitly flagged this as a known future gap for the stock ledger.

This spec adds real credit note issuance: partial or full reversal of a receipt's lines, with VAT computed the same way the original was, stock restored via the existing stock-movement ledger, and the same ZATCA Phase-1 invoice-hash chain and QR treatment receipts already get.

This is also a prerequisite for ZATCA Phase 2 (separate, later spec): ZATCA's Compliance Checks step requires submitting a real, valid credit/debit note sample alongside standard and simplified invoices — this feature is what makes that sample real rather than synthetic.

## 2. Scope

**In scope:**
- `CREDIT_NOTE` added to `DocumentType`.
- `RETURN` added to `StockMovementType` — distinct from `RESTOCK`, so movement history and reports can tell "customer returned this" apart from "we restocked from a supplier."
- Partial or full reversal: a credit note can credit any subset of an original receipt's lines, for any quantity up to what's still creditable on that line (accounting for credit notes already issued against it).
- Stock restoration: each credited line writes a `StockMovement` (`type: RETURN`, positive delta) through the existing `applyStockMovement()` — the same single code path every other stock change already goes through.
- Same permission surface as receipts: any signed-in tenant user (Owner or Cashier) can issue a credit note. No new role gate.
- Credit notes chain into the *same* rolling ZATCA invoice-hash sequence as receipts (see §4) and get the same Phase-1 QR treatment.
- Print/PDF for the new credit note, reusing the receipt print machinery generalized to accept document type.
- Full mobile/tablet responsiveness and English/Arabic i18n, matching every other tenant-facing screen (see §7, §8).

**Explicitly out of scope / deliberately deferred:**
- **Offline issuance.** Receipts have offline PWA sync (separate, already-shipped feature); credit notes do not get this in v1 — a return is a present-customer, present-connectivity transaction in practice, and adding offline support here would mean re-deriving the offline outbox/number-lease machinery for a second document type before it's actually needed. `NumberLease` stays receipt/quotation-only for now.
- **Crediting a quotation.** Quotations aren't real invoices (no hash chain, no QR) — only a `SALES_RECEIPT` can be the target of a credit note.
- **Crediting a credit note.** A credit note cannot itself be credited (no recursive reversal chain). If a credit note was wrong, that's a business-process problem outside this spec's scope.
- **Debit notes.** ZATCA's compliance check accepts credit *or* debit note samples; credit note alone satisfies it. Debit notes (increasing what's owed) are a different, rarer real-world flow and get their own future spec if ever needed.
- **Full standalone "returns" UI/reporting page.** Credit notes are visible via the original receipt's print page and standard document listings; a dedicated Returns dashboard is future work, not required for this pass.

## 3. Data model

```prisma
enum DocumentType {
  SALES_RECEIPT
  QUOTATION
  CREDIT_NOTE
}

enum StockMovementType {
  SALE
  RESTOCK
  ADJUSTMENT
  RETURN
}

model Tenant {
  // ...existing fields...
  nextCreditNoteNumber Int @default(1)
  lastInvoiceHash      String? // renamed from lastSalesReceiptHash: now shared by
                                // SALES_RECEIPT and CREDIT_NOTE, the two real
                                // ZATCA document types on one continuous chain
}

model DocumentLine {
  // ...existing fields...
  creditedForLineId String?
  creditedForLine   DocumentLine?  @relation("CreditedLine", fields: [creditedForLineId], references: [id])
  creditingLines    DocumentLine[] @relation("CreditedLine")
}
```

`lastSalesReceiptHash` is renamed to `lastInvoiceHash` (a plain column rename in the migration) because it's no longer receipt-specific — ZATCA requires one continuous previous-invoice-hash chain across every real tax document an EGS unit issues, not one chain per document type. Quotations still never touch this field (they were never in the chain).

`creditedForLineId` is set only on a `CREDIT_NOTE`'s lines, pointing at the original receipt's `DocumentLine` it reverses. This mirrors `Document.creditNoteOfDocumentId` at the line level and keeps the data append-only: the original line is never mutated when a credit note is issued against it — remaining-creditable quantity is always computed by summing `creditingLines`, never stored redundantly. This matches how `Document`/`DocumentLine` already work everywhere else in the codebase (immutable once written).

No new tenant-scoped table is added, so `TENANT_SCOPED_MODELS` in `src/lib/db/tenant-context.ts` needs no changes — `Document`, `DocumentLine`, and `StockMovement` are already on it.

## 4. Core mechanism

**Remaining-creditable quantity** for an original line = `line.quantity` minus the sum of `quantity` across all `creditingLines` pointing at it. Computed at request time (both when rendering the picker and when validating a submission), never cached.

**Per-line VAT calculation for a partial credit** reuses `calculateLine()` from `src/lib/receipts/calculate-totals.ts` — the same function the original receipt line used — called with the *original line's* `unitPrice` and `vatRate`, and a `discount` scaled proportionally to the credited quantity: `creditedDiscount = round2(originalLine.discount * (creditedQuantity / originalLine.quantity))`. This keeps a partial credit's per-unit pricing and discount rate identical to what the customer was actually charged, rather than re-deriving from the line's total (which would reintroduce the exact rounding problem the total-anchored calculation fix solved for receipts).

**Hash chain and QR**, at credit-note save time (mirroring `src/app/api/receipts/route.ts`'s existing pattern exactly):
1. Read `tenant.lastInvoiceHash` (falling back to `GENESIS_HASH`) as `previousInvoiceHash`.
2. Compute the new `invoiceHash` via the existing `computeInvoiceHash()` — same function, no changes needed, since it already just hashes `previousInvoiceHash + uuid + grandTotal + vatTotal + createdAt`, and `grandTotal`/`vatTotal` on a credit note are simply the (positive) totals of the credited lines.
3. Build the Phase-1 QR via the existing `buildZatcaQrPayload()` — unchanged, same 5-tag structure.
4. Write `tenant.lastInvoiceHash = invoiceHash` in the same transaction, so the next receipt *or* credit note chains off this one.

**Stock restoration**: one `applyStockMovement()` call per credited line, in the same transaction as the `Document`/`DocumentLine` writes — `type: "RETURN"`, `quantityDelta` = the positive credited quantity, `documentId` = the new credit note's id. No changes needed to `applyStockMovement()` itself; it already accepts an arbitrary `StockMovementType` and `documentId`.

**Numbering**: `Tenant.nextCreditNoteNumber`, incremented in the same transaction — same pattern as `nextSalesReceiptNumber`/`nextQuotationNumber` today. Since credit notes are online-only (§2), no `NumberLease` entry is needed.

## 5. API

- `GET /api/receipts/[id]/creditable-lines` — tenant-scoped, any signed-in user. Returns the original receipt's lines, each annotated with `creditedQuantity` (sum already credited) and `remainingQuantity` (`line.quantity - creditedQuantity`). 404 if the document doesn't exist, isn't this tenant's, or isn't a `SALES_RECEIPT`.
- `POST /api/credit-notes` — body `{ originalDocumentId: string, lines: [{ originalLineId: string, quantity: number }], notes?: string }`. Validates: `originalDocumentId` resolves to a `SALES_RECEIPT` in this tenant; every `originalLineId` belongs to that document; every requested `quantity` is positive and ≤ that line's current remaining-creditable quantity (re-checked inside the transaction to close the race between two concurrent credit notes against the same receipt); at least one line present. On success: writes `Document` (`type: CREDIT_NOTE`, `creditNoteOfDocumentId` set, number from `nextCreditNoteNumber`), one `DocumentLine` per credited line (via `calculateLine()` per §4), one `StockMovement` per line, the hash chain update, and the QR — all in one `prisma.$transaction`, same shape as the receipts route's existing save transaction. Returns the created credit note's id.
- Credit note print/PDF: `getReceiptPrintData()` in `src/lib/receipts/get-print-data.ts` is renamed to `getDocumentPrintData()` and takes the target `DocumentType` (`"SALES_RECEIPT" | "CREDIT_NOTE"`) as a parameter instead of hardcoding `"SALES_RECEIPT"` in its `where` clause — its existing two call sites (`print-data` and `pdf` routes) are updated to pass `"SALES_RECEIPT"` explicitly, so their behavior is unchanged. `src/app/api/receipts/[id]/print-data/route.ts` and the PDF route gain credit-note-specific siblings at `/api/credit-notes/[id]/print-data` and `/api/credit-notes/[id]/pdf` that call the same function with `"CREDIT_NOTE"`. The print page itself (`src/app/(app)/receipts/[id]/print/page.tsx`'s rendering) is reused via a shared component, not duplicated, with a label distinguishing "Credit Note" from "Sales Receipt" on the rendered document.

## 6. Navigation & UI

- **Entry point**: an "Issue Credit Note" button on the receipt print page (`src/app/(app)/receipts/[id]/print/page.tsx`), visible only when the receipt has at least one line with remaining-creditable quantity > 0. No entry point from the receipts list — issuing a credit note always starts from a specific receipt.
- **New page**: `src/app/(app)/receipts/[id]/credit-note/page.tsx` — fetches `creditable-lines`, renders each original line with product name, original quantity, already-credited quantity, and a quantity input capped at the remaining amount (defaulting to 0 / not selected). A running total (subtotal/VAT/grand total of the currently-selected credit) updates live, computed client-side via the same `calculateLine()` logic used server-side. Submit calls `POST /api/credit-notes`, then redirects to the new credit note's print page.
- On success, the credit note's print page reuses the existing print/PDF flow, labeled "Credit Note."

## 7. Mobile & tablet responsiveness

Follows the conventions already shipped app-wide (mobile responsive redesign, 2026-08-18) — no new breakpoint philosophy:
- The credit-note picker's line list uses the established `hidden md:block` table / `md:hidden` card-list split.
- Quantity inputs and the running-total summary stack full-width below `md`, matching how the receipt form's own line editor already behaves at narrow widths.
- The "Issue Credit Note" button on the print page follows the same responsive button-group pattern already used there for Print/Download actions.

## 8. i18n

Every new string (button labels, page headings, "already credited" / "remaining" labels, the "Credit Note" document label itself) goes through the existing `dict`/`useLocale()` system (`dictionary.types.ts` / `en.ts` / `ar.ts`), matching every other tenant-facing screen.

## 9. Testing

TDD throughout, matching existing project convention:
- `calculateLine()` — no changes needed, already covered; add a test asserting the proportional-discount-scaling math in §4 produces the expected line totals for a partial credit.
- `get-print-data.ts` — updated tests covering both `SALES_RECEIPT` and `CREDIT_NOTE` lookups, including that a receipt id is never returned when queried as a credit note and vice versa.
- `GET /api/receipts/[id]/creditable-lines` — route test covering full/partial/already-fully-credited lines, wrong-tenant 404, non-`SALES_RECEIPT` 404.
- `POST /api/credit-notes` — route tests: full-document credit, partial-line credit, over-crediting rejected (400), crediting a quotation rejected (404), crediting a credit note rejected (404), concurrent-credit race (two requests crediting the same line's last remaining unit — second must fail), hash-chain continuity with a receipt created immediately before it (asserts the credit note's `previousInvoiceHash` equals the receipt's `invoiceHash`), and a `StockMovement` row (`type: RETURN`) written per credited line with the product's `quantity` correctly incremented.
