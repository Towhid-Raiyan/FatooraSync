# FatooraSync — System Feedback Layer & Print Modal — Design Spec

**Status:** Approved
**Last updated:** 2026-08-15

## 1. Purpose

Two related interaction gaps make the app feel unresponsive today:

1. **No feedback on whether an action worked.** Saving Settings gives no confirmation and — worse — no indication of failure either, since the handler never even checks the response status. Deactivating/reactivating a Product, Customer, or Cashier shows no success confirmation and no in-flight loading state, so a click can look like it did nothing until the list quietly updates a moment later.
2. **Save & Print leaves the page.** Finishing a sale or quotation navigates away to a full print page. The user wants this to open in place instead — save happens immediately (unchanged), then a modal shows the result with Print/Download actions, no navigation.

This spec covers both, since they were designed together and the second reuses the loading-indicator pattern the first introduces.

## 2. Scope

**In scope:**
- A toast notification primitive (success confirmations) built the same way every other UI primitive in this app is: on top of Radix's own primitives (already available via the `radix-ui` package, no new dependency), styled to match the existing design system.
- Loading/disabled states on every button that currently gives no in-flight feedback: Settings' Save button, and every Deactivate/Reactivate button on Products, Customers, and Staff.
- Fixing Settings' save handler to actually check `response.ok` — today a failed save is silently indistinguishable from a successful one.
- A single, reusable print modal, replacing page navigation in all four places printing/viewing currently happens: New Receipt's "Save & Print", New Quotation's equivalent, and the Receipt/Quotation History pages' row actions (today: separate "View" and "Download" links; after: one action opens the modal, which itself offers Print and Download).
- Two new JSON API endpoints (`GET /api/receipts/[id]/print-data`, `GET /api/quotations/[id]/print-data`) so the modal can fetch print-ready data without a page load, plus extracting the data-assembly logic those endpoints need out of the existing print pages into a shared function (so both call sites — the new endpoint and the still-existing print page — stay in sync, never duplicated).
- Consolidating each print component's print-scoping CSS (currently a fragile inline `<style>` block per component, keyed to specific Tailwind class combinations on the app shell) into one shared, robust "print only this element" rule, so the exact same print components work correctly both inside the new modal and on the standalone print pages.

**Explicitly out of scope / deliberately unchanged:**
- The existing inline red-text error messages (next to the field/button that failed) stay exactly as they are — only success gets a toast, per your direction.
- The standalone `/receipts/[id]/print` and `/quotations/[id]/print` pages stay in the codebase, fully functional, just no longer linked to from the UI. Nothing in this spec deletes them.
- The Add/Edit dialogs for Products, Customers, and Cashiers already have a working `saving` state and inline error handling — they only gain a success toast on top, no structural change.
- The actual save/mutation logic (API routes, calculation, ZATCA hash chain, etc.) is untouched everywhere in this spec — this is purely about what the user sees while and after those requests run.

## 3. Toast Notifications

**Component:** `src/components/ui/toast.tsx`, built on Radix's `Toast` primitives (`Toast.Provider`, `Toast.Viewport`, `Toast.Root`, `Toast.Title`, `Toast.Close`) — the same primitive-plus-Tailwind pattern already used by `dialog.tsx`, `checkbox.tsx`, and `badge.tsx`. No new npm dependency.

**Provider placement:** mounted once in `src/app/layout.tsx`, alongside the existing `LanguageProvider` (which already wraps the whole app there) — every page gets access, matching how `LanguageProvider` itself is scoped.

**API shape:** a `useToast()` hook returning a `toast` function: `toast.success(message: string)` / `toast.error(message: string)`. Callers resolve the message text from `dict` themselves before calling it (matching how every component already reads `dict` locally) — the toast primitive itself stays decoupled from the dictionary structure. Every new toast message string is a new dictionary key, added to `dictionary.types.ts`/`en.ts`/`ar.ts` together, following the project's existing i18n convention.

**Visual design:**
- Position: top-end corner (top-right in LTR, top-left in RTL, matching how the rest of the app already mirrors for Arabic).
- Entrance: slide-in-and-fade using the same `tw-animate-css` utilities already used for Dialog's open/close transitions, so it matches the motion language already established rather than introducing a new one.
- Success: a check icon (`lucide-react`'s `CheckIcon`, already used elsewhere) with an `accent-mint`-tinted left border/icon color, matching the success color already used for Active badges.
- Failure (used by the print modal for its own load errors — see §5): an alert icon in the same red already used for inline error text, for visual consistency between the two failure treatments.
- Auto-dismiss after ~4 seconds, always with a manual close (×). Multiple toasts stack rather than replace each other.

## 4. Loading Indicators

Every button below currently fires a `fetch()` with zero visual feedback while it's in flight. Each gets: disabled state, a small spinning icon (`lucide-react`'s existing icon set has `Loader2`; `animate-spin` is a built-in Tailwind utility, no new CSS), and — where the button has static text — a text swap to the existing `dict.common.savingEllipsis` pattern already used elsewhere.

- **Settings' "Save Changes" button** — currently has no `saving` state at all. Gains one, plus the missing `response.ok` check (see §2) and an inline error message in the same style as every other form in the app, for the failure path.
- **Every Deactivate/Reactivate button** on Products, Customers, and the Staff table — these live inside a `.map()` over rows and currently share nothing better than a single list-wide error banner with no per-row indicator. Each gains **per-row** loading state (tracking which row's action is in flight, not a single page-wide flag) so only the clicked row's button shows a spinner — other rows stay interactive.
- Add/Edit dialogs (Products, Customers, Add Cashier) already have this correctly (a `saving` state and "Saving…" text) — unchanged, they just gain the success toast from §3 once the request resolves.

## 5. The Print Modal

**One shared component**, `src/components/documents/print-modal.tsx`, taking a `kind: "receipt" | "quotation"` and a `documentId`, used identically in all four call sites. A single component rather than two near-duplicates, since receipts and quotations already have parallel print components (`ReceiptPrintThermal`/`ReceiptPrintA4` and their quotation equivalents) and parallel data shapes.

**Behavior:**
1. Opens immediately when triggered (Save & Print, or the History row action), showing a loading spinner (§4's pattern) while it fetches print-ready data from the new `GET /api/{receipts|quotations}/[id]/print-data` endpoint.
2. Once loaded, renders the **existing** `ReceiptPrintThermal`/`ReceiptPrintA4`/quotation-equivalent components unchanged — same visual output as today, reused as-is, chosen the same way the print pages already choose between them (the tenant's `Settings.printFormat`).
3. Footer has two actions, present in every context (New Receipt/Quotation and History alike, for consistency): **Print** (`window.print()`, scoped to the modal's content — see below) and **Download** (an unchanged link to the existing PDF route). Closing (× or clicking outside) dismisses the modal without side effects.
4. If the data fetch fails, a `toast.error(...)` fires (§3) and the modal shows a simple retry state rather than a blank/broken dialog.

**New Receipt/Quotation flow specifically:** the Save request fires immediately on clicking "Save & Print" (unchanged from today — the record is already permanent by the time the modal appears, consistent with receipts' immutability). The modal then opens showing the just-created document — the modal appearing with the finished document *is* the success confirmation for this action, so it does not additionally fire a §3 toast (that would be redundant with the modal itself). The plain "Save" (no print) button, which has no modal, does get a success toast. Closing the print modal resets the form for the next sale, matching how "Save" already resets the form today.

**History pages specifically:** the current two separate row actions ("View" → full page, "Download" → direct PDF link) collapse into one action that opens this same modal; Download moves into the modal's footer alongside Print.

**Print-scoping CSS (the part that makes reuse actually work):** the print components currently each carry an inline `<style>` block hiding the app shell via `@media print`, keyed to specific Tailwind class combinations (e.g. `.flex.h-screen`, `div.border-b.border-border-subtle.backdrop-blur-sm`) — fragile, and it assumes the surrounding page is always the same app-shell layout. This gets replaced with one global, robust rule (in `globals.css`): the print content gets a stable wrapper (e.g. `id="print-target"`), and a single `@media print { body * { visibility: hidden } #print-target, #print-target * { visibility: visible } #print-target { position: fixed; inset: 0 } }`-style rule makes everything else on the page — sidebar, topbar, the modal's own Print/Download/Close buttons, the page behind the modal — disappear when printing, regardless of whether the content is sitting inside a Dialog portal or a standalone page. This is what lets the exact same print components work correctly in both the new modal and the (kept, unlinked) standalone print pages without maintaining two different print-CSS strategies.

**New JSON endpoints:** `GET /api/receipts/[id]/print-data` and `GET /api/quotations/[id]/print-data`, same auth/tenant-scoping shape as every other route in this codebase (`auth()` session check, `assertTenantAccess`, `withTenant`). The document/lines/customer/tenant/QR-code-image assembly they need is identical to what the existing print pages already compute — that logic is extracted into a small shared function per document type (e.g. `src/lib/receipts/get-print-data.ts`) so the new endpoint and the existing (kept) print page both call it, rather than each having its own copy that could drift.

## 6. What Doesn't Change

- Save/mutation API logic, ZATCA hash chain, calculation functions, and database schema — untouched.
- The plain "Save" (no print) button on New Receipt/Quotation — unaffected, still resets the form immediately.
- The standalone print page routes — kept, functional, just unlinked from the UI.
- Inline field/button-level error text — kept exactly as-is; only success moves to toast.
