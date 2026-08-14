# FatooraSync

Cloud-based, multi-tenant POS and business-management SaaS for Saudi SMEs — grocery, hardware, retail, pharmacy, and similar shops. Receipts, quotations, products, customers, ZATCA-ready invoicing, and a fully bilingual (Arabic/English, RTL-aware) interface, built to launch in Saudi Arabia with room for GCC expansion later.

## Status

**The product is feature-complete against its original MVP scope.** The business layer needed to sell, provision, and support it as a real multi-client SaaS — billing control, staff roles, an internal admin panel — is designed but not yet built.

### Built and working
- Auth & manual tenant onboarding (email/password, JWT sessions)
- Customers & Products — CRUD, autocomplete, quick-create from the receipt screen, per-product VAT override
- Sales Receipts — immutable once saved, ZATCA Phase-1 QR code, stock-decrementing
- Quotations — editable/deletable, same calculation engine as receipts
- Receipt & Quotation history — searchable, filterable, PDF export
- Settings — VAT rate, print format, business phone
- Print output — thermal receipt-roll layout and full A4, both always bilingual (AR+EN) regardless of the app's own UI language
- Full English/Arabic interface with RTL mirroring, a personal per-user language preference
- CI — typecheck, lint, and the full test suite on every push/PR

### Designed, not yet built
- **Deployment** — nothing has been deployed anywhere yet; everything above only exists in local development so far
- **The agency control plane** — tenant billing status & feature flags, an internal admin panel, two-tier access inside each shop (Owner/Cashier, with an owner-controlled catalog-management toggle), a separate staff-access model for the agency itself (CTO/Developer), audit logging for cross-tenant actions
- A real payment gateway integration and self-serve signup
- ZATCA Phase 2 (live API submission, cryptographic stamping)
- Offline-first sync and a desktop app

Everything in "designed, not yet built" is deliberately deferred, not forgotten — see the spec documents below for the reasoning behind each.

## Documentation

Every feature was designed before it was built. Full history, in order, spec first then the implementation plan built from it:

| Date | Feature | Spec | Plan |
|---|---|---|---|
| 2026-08-06 | MVP foundation | [spec](docs/specs/2026-08-06-fatoorasync-mvp-design.md) | [plan](docs/plans/2026-08-06-fatoorasync-foundation-plan.md) |
| 2026-08-09 | Design system | [spec](docs/specs/2026-08-09-fatoorasync-design-system.md) | [plan](docs/plans/2026-08-09-fatoorasync-design-system-plan.md) |
| 2026-08-09 | Customers | [spec](docs/specs/2026-08-09-fatoorasync-customers-design.md) | [plan](docs/plans/2026-08-09-fatoorasync-customers-plan.md) |
| 2026-08-10 | Products | [spec](docs/specs/2026-08-10-fatoorasync-products-design.md) | [plan](docs/plans/2026-08-10-fatoorasync-products-plan.md) |
| 2026-08-10 | Sales Receipt | [spec](docs/specs/2026-08-10-fatoorasync-sales-receipt-design.md) | [plan](docs/plans/2026-08-10-fatoorasync-sales-receipt-plan.md) |
| 2026-08-11 | Receipt History | [spec](docs/specs/2026-08-11-fatoorasync-receipt-history-design.md) | [plan](docs/plans/2026-08-11-fatoorasync-receipt-history-plan.md) |
| 2026-08-11 | Quotation | [spec](docs/specs/2026-08-11-fatoorasync-quotation-design.md) | [plan](docs/plans/2026-08-11-fatoorasync-quotation-plan.md) |
| 2026-08-12 | Print Format (Thermal/A4) | [spec](docs/specs/2026-08-12-fatoorasync-print-format-design.md) | [plan](docs/plans/2026-08-12-fatoorasync-print-format-plan.md) |
| 2026-08-13 | Language switcher (EN/AR) | [spec](docs/superpowers/specs/2026-08-13-i18n-language-switcher-design.md) | [plan](docs/superpowers/plans/2026-08-13-i18n-language-switcher-plan.md) |
| 2026-08-14 | Agency control plane & access model | [spec](docs/superpowers/specs/2026-08-14-fatoorasync-agency-platform-design.md) | *not yet planned* |

Start with the MVP spec for the product's original vision and scope decisions, and the agency platform spec for what's planned next.

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS + Radix UI · PostgreSQL on Neon · Prisma · Auth.js (JWT sessions) + argon2 · `@react-pdf/renderer` + `qrcode` (ZATCA QR) · Sentry · Pino · Vitest

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Database setup

Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `DIRECT_URL`, and `AUTH_SECRET`.

Before running migrations against a fresh Postgres instance (a new environment, a local database, CI), the `fatoorasync_app` role referenced by the migrations must be created first — it isn't created by any migration itself. See [`prisma/migrations/README.md`](prisma/migrations/README.md) for why and the exact bootstrap step.

### Checks

```bash
npm run typecheck
npm run lint
npm test
```
