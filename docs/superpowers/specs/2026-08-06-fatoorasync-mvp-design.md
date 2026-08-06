# FatooraSync — MVP Design Spec

**Status:** Design complete — pending final user review of this document, then handoff to `superpowers:writing-plans` for an implementation plan.
**Last updated:** 2026-08-06
**Process:** Produced via the `superpowers:brainstorming` skill. Do not begin implementation/coding until the user has reviewed this file and explicitly approved it.

## 1. Vision

FatooraSync is a cloud-based, multi-tenant POS/business-management SaaS for SMEs (grocery, chocolate, hardware, retail, electronics, pharmacy shops), launching in Saudi Arabia with planned future expansion to UAE, Qatar, Kuwait, Bahrain, Oman. Core philosophy: simplicity, speed, zero learning curve, bilingual (Arabic-first, full RTL) + English, enterprise-grade reliability under the hood. Long-term (post-MVP) goal: offline-capable local+cloud hybrid sync. Full original vision brief is preserved in project conversation history; this doc captures the distilled, decided design.

## 2. MVP Scope — APPROVED

**In scope for this design/build cycle:**
- Auth & tenant onboarding (single owner login per business; tenants provisioned manually — no self-serve payment signup)
- Customers: CRUD, name/VAT-ID autocomplete, default "Walk-in Customer", auto-create customer when a receipt is saved with a new VAT ID
- Products: CRUD, barcode/SKU/name autocomplete, quick-create modal from the receipt screen, per-product VAT override
- Sales Receipt: line items, real-time subtotal/VAT/total, stock decrement on save, **immutable once saved**, ZATCA-ready fields including a real Phase-1 QR code, bilingual (AR+EN) print output
- Quotation: same engine as Sales Receipt, no ZATCA fields, document clearly labeled "Quotation", **editable/deletable** (unlike receipts)
- Sales History / Quotation History: searchable, filterable
- System Settings: default VAT %, language

**Explicitly out of scope for MVP** (architecture must not preclude adding these later): Inventory (restock/adjustments/low-stock alerts), Purchase Orders, Suppliers, Expenses, Employee/staff roles & permissions, Accounting, CRM/Loyalty, Multi-store/multi-branch, ZATCA Phase-2 live API integration & cryptographic stamping, Credit Note/Returns *workflow* (data relationship reserved now, UI/flow later), offline/local hybrid client, payment gateway, multi-currency.

**Design principles that keep those doors open** (already binding on the MVP build, not deferred):
- Every tenant-scoped table carries `tenant_id` from day one — required for future multi-store and for keeping tenant isolation retrofit-free.
- `Document` has a nullable self-reference (`credit_note_of_receipt_id`) reserved now, unused until returns ship.
- `Product.quantity` is a plain counter now; a future Inventory module adds stock *movements* (ledger) that derive the same counter — no field rename needed.
- API routes are organized by resource, not entangled in page/component code, so a future dedicated backend extraction or an offline client has a clean contract to consume.

## 3. Requirements Review — Resolved Decisions

| Area | Decision | Rationale / notes |
|---|---|---|
| Team & stack | Solo builder, no stack lock-in | Drives lean architecture choice |
| Offline/hybrid sync | Cloud-only for MVP | Full offline-first is a large separate effort; data model must not block it later |
| ZATCA compliance | Data model ZATCA-Phase-1-ready (UUID, invoice hash, chained previous-invoice hash); **real Phase-1 QR code rendered on printed receipts in MVP** | QR generation is local TLV encoding, no ZATCA API/registration required — cheap enough to build now. Phase 2 (cryptographic stamping, live API submission) deferred, since that needs real ZATCA onboarding |
| Staff roles | Single login per tenant for MVP | Schema allows staff roles/permissions later |
| Printing | Browser/PDF print route first; `PrintRenderer` abstraction so thermal ESC/POS can be added later without touching Document logic | Avoids native/local-agent complexity in MVP |
| Billing/payments | No payment gateway in MVP; tenants provisioned manually | Keeps MVP scope to the product itself, not subscription commerce |
| Hosting | Bootstrap-lean; managed platforms over self-managed infra | Solo operator, 1–3 month timeline |
| Stock deduction | Sales Receipt decrements `Product.quantity` (simple counter) | "Initial Quantity" field is otherwise meaningless; full Inventory module later |
| Receipt mutability | **Immutable once saved.** Returns/corrections handled later via a linked **credit note** (new document referencing the original invoice's UUID, reversing VAT) — not by editing/deleting the original | Matches Saudi return/refund practice and ZATCA credit-note pattern; data relationship reserved now, workflow built later |
| Quotation mutability | **Editable/deletable** by the owner, unlike receipts | Quotations aren't fiscal documents; owners routinely revise and resend quotes |
| Product/Customer deletion | **Soft delete** (inactive flag) | Disappears from search/autocomplete immediately, but historical receipts referencing it keep showing correct name/price/VAT — no delete is ever blocked by history |
| Timeline | 1–3 months to first pilot business | Favors lean, low-ceremony architecture over maximal separation |
| Auth method | Email + password, database-backed sessions | Simpler to build correctly than phone/OTP; sessions are revocable |
| Print language | Bilingual (AR + EN) on every printed receipt, regardless of active UI language | Standard for KSA retail; avoids ambiguity for mixed customer bases |
| VAT granularity | **Per-product VAT rate/exemption**, defaulting to the tenant's global VAT setting | Real KSA grocery/pharmacy baskets mix standard-rated and zero-rated/exempt items; retrofitting later touches receipt totals, ZATCA fields, and historical reports |

## 4. Assumptions (stated, not yet challenged by user)

1. **Currency:** SAR only for MVP; multi-currency deferred to GCC expansion.
2. **Locations:** one location per tenant in MVP (multi-store is explicitly future).
3. **Units of measure:** fixed predefined list (Piece, KG, Box, Carton, Liter, etc.), not user-customizable in MVP.
4. **Numerals:** Western digits (0–9) used even in Arabic-language UI/print, per common KSA business/ZATCA convention (not Eastern Arabic numerals).

## 5. Architecture Decision — APPROVED

**Chosen: Option A — Next.js full-stack monolith.**

- TypeScript, Next.js (App Router) for UI + API (route handlers)
- PostgreSQL, tenant-scoped via `tenant_id` on every tenant table + Postgres Row-Level Security as a defense-in-depth backstop against app-layer isolation bugs
- Prisma or Drizzle ORM (final pick pending — not architecturally significant, decide at implementation planning)
- Auth.js for email/password auth, database-backed sessions
- `next-intl` for AR/EN + RTL
- Deployment: Vercel + managed Postgres (Neon or Supabase — final pick pending)

**Why (over decoupled API+SPA, and over Laravel+Filament):** fastest path for a solo builder on a 1–3 month timeline; one language, one deploy target, huge ecosystem. Next.js route handlers are a real, isolated API surface (not tangled into page rendering), so extracting a dedicated backend later — when the offline/hybrid-sync client is actually built — is additive, not a rewrite. Laravel+Filament was a legitimate alternative (mature multi-tenancy package, strong regional ecosystem fit) but wasn't chosen since the user has no existing PHP preference and Option A is equally fast with less new-language risk.

## 6. Data Model — Core Entities

**Multi-tenancy approach:** pooled/shared schema — one database, every tenant-scoped table carries `tenant_id`, enforced twice (application-layer query scoping through a single data-access layer that always injects `tenant_id` server-side + Postgres Row-Level Security as a backstop). This is the standard model for SaaS with many small tenants (Rewaa/Foodics/Shopify-style) — database-per-tenant or schema-per-tenant doesn't scale operationally once there are hundreds of tiny SME tenants each needing migrations run against them.

**Entities:**

- **Tenant** — legal name, trade name (EN/AR), VAT registration number, CR number, address, default language.
- **User** — `tenant_id`, email, password hash. One per tenant in MVP; shape already supports more later.
- **Settings** — 1:1 with Tenant: default VAT rate, default language. Kept separate from Tenant so it can grow without bloating the core business-identity row.
- **Customer** — `tenant_id`, name, VAT ID (nullable, unique *within* a tenant, not globally), address, phone, CR number, active flag (soft delete). Every tenant gets an auto-seeded, non-deletable "Walk-in Customer" row.
- **Product** — `tenant_id`, name (EN required, AR optional), SKU, barcode, unit (enum), unit price, VAT rate override (nullable — falls back to tenant default), quantity (simple counter), active flag (soft delete).
- **Document** (Sales Receipt & Quotation) — `tenant_id`, `type` (sales_receipt | quotation), customer_id, subtotal/vat/grand total, notes, `credit_note_of_receipt_id` (reserved, nullable), and ZATCA fields: `uuid`, `invoice_hash`, `previous_invoice_hash`, `qr_code` (populated for sales_receipt only). Sales receipts are immutable after save; quotations are editable/deletable. **Numbering is a separate sequence per document type** — sales receipts get a sequential, gapless, per-tenant invoice number (this is what `previous_invoice_hash` chains against, per ZATCA's tamper-evidence requirement), quotations get their own independent per-tenant quotation number. They are never interleaved in one counter.
- **DocumentLine** — `document_id`, `product_id`, and **snapshotted** `product_name`, `unit_price`, `vat_rate` at the moment of sale — required because documents are immutable, so a later change to a product's price/VAT must never alter a historical receipt.

## 7. Cross-Cutting Design

**Auth:** Auth.js (NextAuth), credentials provider, email + password (argon2id hashing), database-backed sessions via the ORM adapter (revocable, unlike pure JWT). `User.tenant_id` is a direct FK.

**i18n/RTL:** `next-intl`, Arabic as default locale, `dir="rtl"` toggled on the root `<html>` element per locale, Tailwind logical properties (`ms-`/`me-`) for automatic layout mirroring. Language preference stored on `Settings`, switchable instantly without a full reload.

**ZATCA readiness:** Phase-1 QR code (Base64 TLV: seller name, VAT number, timestamp, invoice total, VAT total) genuinely generated and printed on sales receipts in MVP — pure local computation, no external dependency. Invoice hash chaining (`previous_invoice_hash`) implemented at the data layer now so Phase-2 cryptographic stamping and live API submission can be added later without restructuring historical records.

**Print pipeline:** a `PrintRenderer` abstraction — Document is the single source of truth, a renderer turns it into an output. MVP ships one renderer: a print-optimized web route (`@media print` CSS, "Save & Print" triggers the browser print dialog), bilingual layout, tenant header, and the QR code image. Thermal ESC/POS and server-side PDF (for future emailing) are later renderers behind the same interface.

## 8. Non-Functional Posture for MVP

**Testing:** Vitest for unit + integration tests. Two things are tested regardless of time pressure: (1) VAT/total calculation and ZATCA TLV/QR encoding — wrong numbers on a tax document is a real liability; (2) a tenant-isolation test asserting tenant A can never read/write tenant B's data — the single most important test in a multi-tenant system. No broad E2E suite; at most one smoke test for the critical path (login → create receipt → appears in history).

**Observability:** Structured logging (pino) with `tenant_id` on every log line, Sentry for error tracking. No metrics/tracing stack (Prometheus/OpenTelemetry) for MVP — premature at pilot scale, revisit as tenant count grows.

**CI/CD:** GitHub Actions runs typecheck + lint + tests on every PR; Vercel auto-deploys `main`, with free preview deployments per PR doubling as a staging environment during the pilot phase. DB migrations committed to the repo and applied as a deploy step, never run by hand.

**Security baseline:** every tenant-scoped query goes through one data-access layer that injects `tenant_id` server-side — a client-supplied `tenant_id` is never trusted; Postgres RLS is the backstop if that layer is ever bypassed by mistake. Basic rate limiting on the login endpoint, since MVP has no 2FA/OTP fallback.

## Next Step

Once the user has reviewed and approved this document as written, the next step is to invoke `superpowers:writing-plans` to produce a concrete implementation plan (milestones, epics, tasks) — not to begin coding directly from this spec.
