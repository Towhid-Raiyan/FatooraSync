# App-Wide Language Switcher (English/Arabic) — Design

## Goal

Add a language dropdown to the main navigation (Topbar) that lets each user
personally switch the entire on-screen app between English and Arabic,
independent of what other staff at the same shop see. Selecting Arabic
mirrors the layout to right-to-left, matching how native Arabic interfaces
read. Printed receipt/quotation documents are unaffected — they already
show both languages together and continue to do so regardless of this
setting.

## Current state (before this feature)

- `Settings.language` (Prisma `Settings` model, `String @default("ar")`) is
  stored and editable from the Settings page, but nothing in the app
  actually reads it to change any UI text today — it's inert.
- No translation library or dictionary exists anywhere in the codebase.
- The app has no locale-prefixed routes (`/receipts/new`, `/settings`,
  etc. — no `/en/`, `/ar/` segments), and this feature does not add any.
- The layout already leans on CSS logical properties (`border-s-`,
  `-end-`, `-start-`) rather than hardcoded left/right in several places
  (`sidebar.tsx`, `app-shell.tsx`, `login/page.tsx`), which flip
  automatically once `dir="rtl"` is set on `<html>` — no extra work needed
  for those. A grep found ~11 remaining spots using hardcoded
  `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-` across `button.tsx`, `badge.tsx`,
  `dialog.tsx`, `table.tsx`, `items-section.tsx`, and `desert-scene.tsx`
  that need per-instance review.
- `IBM_Plex_Sans_Arabic` is already loaded as a font in the root layout
  (`src/app/layout.tsx`) as a CSS variable, but never actually applied —
  the app always renders with `Plus_Jakarta_Sans` today.

## Decisions

1. **Scope: personal, per-browser preference.** The nav dropdown sets a
   cookie unique to that browser/device. It does not write to the shop's
   `Settings.language` — each person's choice is independent of what
   other users at the same tenant see.
2. **`Settings.language` becomes the shop-wide default** for a
   first-time visitor who has no cookie yet (e.g. a brand-new browser
   hitting `/login` for the first time). Once someone picks a language
   from the nav dropdown, their cookie overrides that default from then
   on. The Settings page keeps its Language field, relabeled with a short
   caption clarifying this new meaning.
3. **Full RTL mirroring** when Arabic is active — not just translated
   text. Sidebar, content flow, and spacing all mirror via `dir="rtl"` on
   `<html>`, relying on the app's existing logical-property CSS plus
   flexbox's built-in direction-awareness, with the ~11 hardcoded
   left/right spots fixed individually.
4. **Printed documents are out of scope.** The A4/thermal receipt and
   quotation print templates keep behaving exactly as they do today
   (always bilingual). Only the on-screen app UI — nav, forms, buttons,
   tables, placeholders, messages — is translated. The print *page's*
   surrounding chrome (e.g. the "Print" button above the printable area)
   is in scope; the printable document content itself is not.
5. **Full coverage, one pass.** Every page under the `(app)` layout, plus
   `/login`, gets translated in this pass — not just navigation and the
   receipt form sections named in the original request.
6. **No numeral localization.** Prices, quantities, and dates keep
   regular digits (0,1,2…) in both languages, matching how the existing
   print/PDF documents already format numbers.
7. **Hand-rolled dictionary, not a library.** Two flat TypeScript
   dictionary files (`en.ts`, `ar.ts`) plus a small Context provider,
   rather than adopting `next-intl` or similar. Justification: only two
   languages, no pluralization/ICU-formatting need (reinforced by
   decision 6), and this matches the codebase's existing preference for
   plain objects over added dependencies (e.g. `UNIT_LABELS` in
   `product-form-dialog.tsx`). All strings are centralized in two files
   either way, so migrating to a library later — if ever needed — is a
   mechanical, low-risk change.
8. **New-tenant schema default changes from `"ar"` to `"en"`**, per the
   requirement that the app "primarily" defaults to English. The demo
   tenant's already-configured `Settings.language` value (`"ar"`) is left
   untouched — this feature does not overwrite existing tenant
   configuration.

## Architecture

### Locale resolution (`src/lib/i18n/locale.ts`)

```ts
export type Locale = "en" | "ar";
export const LOCALE_COOKIE = "fs-locale";
```

A `resolveLocale()` server-side helper, used by the root layout:

1. Read the `fs-locale` cookie via `cookies()` (`next/headers`). If set to
   `"en"` or `"ar"`, use it.
2. Otherwise, if there's an active session, read that tenant's
   `Settings.language` and use it.
3. Otherwise, default to `"en"`.

### Root layout (`src/app/layout.tsx`)

Becomes an `async` Server Component. Calls `resolveLocale()` once, sets
`<html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>`, and applies
the Arabic font when `locale === "ar"` (conditional className swap between
the `Plus_Jakarta_Sans` and `IBM_Plex_Sans_Arabic` CSS variables already
loaded there). Wraps `{children}` in `<LanguageProvider initialLocale={locale}>`.

### Dictionaries (`src/lib/i18n/dictionaries/{en,ar}.ts`)

Nested plain objects, grouped by area — `nav`, `common` (Save, Cancel,
Actions, etc.), `home`, `settings`, `products`, `customers`,
`receiptForm` (with `customerSection`, `itemsSection`, `totals`
sub-groups), `quotationForm` (mirrors `receiptForm`, matching this
codebase's established "duplicate rather than couple receipts/quotations"
convention), `receiptHistory`, `quotationHistory`, `printChrome`, `login`.
A `get-dictionary.ts` helper (`getDictionary(locale): Dictionary`) is
usable from both Server and Client Components — it's a synchronous object
lookup, no I/O.

### Language Context (`src/lib/i18n/language-provider.tsx`)

Client Component. `useLocale()` hook returns `{ locale, dict, setLocale }`.
`setLocale(next)` writes the `fs-locale` cookie (1 year, `SameSite=Lax`),
updates Context state immediately (so Client Components re-render without
waiting on the network), and calls `router.refresh()` so Server Components
on the current page re-render with the new locale's dictionary too.

### Nav dropdown (`src/components/shell/language-switcher.tsx`)

Client Component, rendered in `Topbar`, right side, next to the user's
email. A plain `<select>` (matching the existing Settings page's
select-styling pattern — no shadcn `Select` primitive exists in this repo
yet, and this feature doesn't need to introduce one). Two options,
each labeled in its own language: `English` / `العربية`.

### Settings page

No functional/API change. The Language field's label gets a short caption
clarifying it now means "default for new visitors," since a personal nav
choice overrides it per-browser. Separately, a Prisma migration changes
`Settings.language`'s column default from `"ar"` to `"en"` (decision 8) —
this only affects rows created after the migration; it does not touch any
existing tenant's already-stored value, including the demo tenant's.

### Translation coverage (this pass)

Every page/component under `src/app/(app)/**` and `src/app/login/page.tsx`,
plus their component trees: `Sidebar`/`Topbar`/`AppShell`, Home dashboard,
Settings, Products (list + `product-form-dialog.tsx`), Customers (list +
`customer-form-dialog.tsx`), New Receipt (`receipt-form.tsx`,
`customer-section.tsx`, `items-section.tsx`), New Quotation
(`quotation-form.tsx`, sharing `customer-section.tsx`/`items-section.tsx`),
Receipt History (`receipt-history-client.tsx`), Quotation History
(`quotation-history-client.tsx`), the print pages' non-document chrome
(`print-button.tsx`), and Login. Shared primitives (`button.tsx`,
`dialog.tsx`, `table.tsx`, etc.) only need the physical-property RTL fixes
noted above — they don't own their own copy, since the strings that flow
through them (button labels, table headers) live in the calling
component's dictionary usage.

**Explicitly not translated:** tenant/business data (product names,
customer names, notes typed in by the shop), and the printed
receipt/quotation document content itself (already bilingual by design).

## Testing

- Unit tests for `resolveLocale()`'s three-tier fallback (cookie → tenant
  Settings → `"en"`).
- Unit tests confirming the `en`/`ar` dictionaries have identical key
  shapes (catches a typo'd or missing key in one language before it ships
  as a blank string in the UI).
- Manual browser verification (per this project's established practice):
  toggle the dropdown, confirm `dir`/`lang` flip, confirm the sidebar
  visually mirrors, confirm a sampling of pages (Home, New Receipt,
  Settings, Products) render fully in Arabic with no leftover English
  strings, and confirm the printed A4/thermal output is unchanged in both
  modes.
