# FatooraSync — Design System & App Shell Spec

**Status:** Approved
**Last updated:** 2026-08-09

## 1. Why this exists

The MVP design spec (`2026-08-06-fatoorasync-mvp-design.md`) and the foundation implementation covered architecture, data model, and backend plumbing — auth, tenant isolation, settings. No visual design work had happened: the built pages (login, settings) were unstyled Next.js defaults with plain HTML form elements. This spec covers the visual design system and app shell that every future screen builds on, following the same phased approach as the backend: design system first, then feature screens (Products & Customers next, then Sales Receipt & Quotation) on top of it.

## 2. Component approach — APPROVED

**shadcn/ui + Tailwind CSS v4.** Accessible, unstyled component primitives (Radix UI underneath) copied directly into the codebase rather than installed as an opaque dependency — full ownership and customizability, no vendor lock-in. This is the standard choice for the Next.js + TypeScript + Tailwind stack already in place, and it directly serves the stated product principles: clean code, maintainability, industry-standard, future scalability, without sacrificing visual quality.

Icons: `lucide-react` (shadcn/ui's standard companion icon set). Mockups in this spec use emoji as stand-ins for icons; real implementation uses lucide icons throughout.

## 3. Visual identity — "Riyadh Green"

**Primary color:** `#006C35` (deep, confident, flag-inspired Saudi green). Used for the sidebar, primary buttons, focus rings, and brand accents.

**Palette:**
| Token | Hex | Usage |
|---|---|---|
| `primary` | `#006C35` | Base brand green |
| `primary-hover` | `#007A3D` → `#045A2C` (gradient) | Primary button fill, sidebar gradient |
| `primary-dark` | `#003D1F` | Sidebar gradient end, deep accents |
| `accent-mint` | `#6FE3A6` | Active nav indicator, status dots, highlights on dark green |
| `accent-beige` | `#C9A876` | Desert motif secondary tone (camel, architecture, sky elements) |
| `text-heading` | `#0A3D24` | Headings, emphasized values |
| `text-body` | `#3F5C4D` / `#233A2C` | Body text on light backgrounds |
| `text-muted` | `#6B7A72` / `#8A968E` | Labels, secondary text |
| `border-subtle` | `#EDF2EE` / `#E1E8E3` | Card borders, input borders |
| `bg-app` | `#FAFBFA` / `#FCFDFC` | Main app background base |
| `bg-card` | `#FFFFFF` | Card surfaces |

Two rejected directions, kept here for the record: "Modern Sage" (lighter `#10B981` emerald, more generic-SaaS feeling) and "Forest Enterprise" (muted `#14532D` with a cream `#FEFCF8` background). Riyadh Green was chosen for feeling more distinctly, confidently Saudi rather than generic-fintech.

## 4. Background treatment

Two distinct treatments, deliberately different by context:

**Login screen:** a composed desert horizon scene rendered as a single low-opacity (8–16%) shadow layer along the base of the screen — a prominent camel silhouette (beige tone) on the left, five date palm trees (green tone, fuller crowns with drooping fronds and hanging date clusters) stepping down in height across the middle, a small mosque-dome skyline silhouette (beige) on the right, plus small clouds and a crescent moon (beige) near the top. This is a brand/first-impression moment — memorable, culturally specific, not applied anywhere else.

**Main app (after login):** **not** flat white. A soft, slowly-drifting blurred gradient glow (two large blurred circles in mint/sage tones at ~18% opacity, subtle `glowFloat` animation) plus a barely-visible dot/line grid (~3.5% opacity) behind the content. Reads as premium and quietly alive without competing with data during fast, repeated daily use. This decision was explicit: work screens (Products, Settings, Sales Receipt entry) stay clean and maximally legible — decorative motifs are not appropriate where cashiers are scanning data for hours; the desert scene specifically stays login-only.

Rationale for the split: a decorative background that's appropriate for a 5-second brand impression (login) actively hurts usability across hours of repeated data entry (main app). The main app's subtle gradient-glow treatment gives visual richness without that cost.

## 5. Typography

**Plus Jakarta Sans** (Latin/English) + **IBM Plex Sans Arabic** (Arabic) — both free (Google Fonts), open-license, and weight-matched so the UI feels like one designed system in either language rather than "English font with Arabic bolted on." Numerals stay **Western (0–9)** even in Arabic-language UI, per the MVP spec's KSA business/ZATCA convention.

Scale (as used in mockups, to be formalized as Tailwind theme tokens during implementation): headings 16–20px/700–800 weight, body 13–13.5px/400–500, labels 10.5–11px/700 weight uppercase with letter-spacing, large emphasis values (totals, tenant name) 22–44px/700–800.

## 6. App shell

**Persistent sidebar navigation** (not a collapsible/hamburger menu) — dark green gradient (`#045A2C` → `#003D1F`), all primary sections always visible: Home, New Receipt, Quotations, Products, Customers, History, Settings. Active item gets a mint (`#6FE3A6`) left-border indicator and a lighter background tint. Rationale: for a POS-style tool used for fast, repeated daily workflows, instant access to every section beats saving sidebar pixels — "minimal clicks" from the original brief argues directly against hiding navigation behind a menu toggle.

**Top bar:** page context only (eyebrow label + title, e.g. "Sales / New Sales Receipt", plus a status badge like "Draft" where relevant). No page-level primary actions live in the top bar — see §8 on button placement.

**Tenant identity** sits at the bottom of the sidebar (avatar initials + tenant name), reinforcing which business context the user is in — relevant since a future multi-store/staff-login world will make this more important, not less.

## 7. Home / dashboard screen

Post-login landing screen, not a static splash: large tenant name ("Al Waha Grocery") in a gradient-text treatment, animated rise-in on load, "Powered by FatooraSync" quietly beneath it, backed by real functional content — today's quick stats (sales count, SAR total, product count, customer count) as hoverable cards, and a primary "+ New Sales Receipt" call-to-action with a shimmer sweep on hover. Entrance animations are staggered (label → tenant name → tagline → stats → CTA) for a deliberate, premium feel rather than everything appearing at once.

## 8. Component patterns

**Cards:** white background, 12–16px border radius, subtle border (`#EDF2EE`), layered soft shadows (never a single flat drop-shadow — always 2–3 shadow layers at different blur/spread for real depth), gentle lift + shadow increase on hover where the card is interactive.

**Buttons:**
- Primary: green gradient fill, white text, soft shadow, lifts 1–2px with shadow growth on hover.
- Ghost/secondary: transparent fill, green border, subtle background tint on hover.
- **Placement rule:** a page's primary actions (Save, Save & Print) live in exactly **one** place — anchored near the totals/summary they act on (e.g., under the receipt total, not duplicated in the top bar). This was a direct correction during design review: an earlier draft had Save/Save & Print in both the top bar and near the totals, which read as cluttered and redundant.

**Forms:** uppercase, small, muted labels above each input; green focus ring (`box-shadow` glow, not a hard outline); grouped logically into cards with a small icon + title header (e.g., "Customer", "Items", "Notes").

**Tables (line items):** numeric columns right-aligned, text columns left-aligned, row hover highlight, a compact monospace SKU/product-code column separate from the product name column. Per-row actions: a single tick button (filled green = confirmed/locked, dashed outline = still editing — matches the MVP spec's "row remains editable until confirmed" behavior) as the always-visible primary action, with delete revealed only on row hover to keep the table visually calm.

**Status badges:** small pill shapes, tinted background matching the semantic meaning (e.g., green tint for a standard VAT rate, neutral gray tint for "Exempt").

## 9. Sales Receipt screen (worked example)

Validates that the design system holds up on the busiest, most complex screen in the product:
- **Customer section**, its own card: Name, VAT ID, CR Number, Phone (two-up paired fields), Address (its own full-width row below, separated by a light divider). Matches the MVP spec's customer fields exactly.
- **Items section**, its own card: a prominent scan/search bar (barcode-scanner-friendly — large touch target, stays focused) above the line-item table (SKU → Product → Unit Price → Qty → VAT → Total → confirm/delete).
- **Notes section**, its own card, plain textarea.
- **Totals + actions**, a sticky card in a right-hand column: Subtotal, Total VAT, Grand Total (large, emphasized), then Save & Print (primary) / Save (ghost) — the only place these actions appear on the page.

This card-per-concern layout (Customer / Items / Notes / Totals, each visually distinct) is the pattern later screens should follow rather than one undifferentiated form.

## 10. RTL and bilingual behavior

Not newly decided here (already committed in the MVP spec) but restated as binding on this design system: `next-intl` for translations, Arabic as default locale, `dir="rtl"` toggled on the root `<html>` element per locale, Tailwind logical properties (`ms-`/`me-`, not `ml-`/`mr-`) throughout so layout mirrors automatically. The sidebar, topbar, and card layouts described above must all mirror correctly under RTL — this is a requirement on implementation, not optional polish.

## 11. What this spec does not cover

Detailed screen design for Products, Customers, Quotation, and History pages — those get their own design pass (reusing every token and pattern defined here) when that implementation cycle starts. This spec's job is the reusable foundation: palette, typography, shell, card/button/form/table patterns, and one fully worked example (Sales Receipt) proving the system holds up under real complexity.
