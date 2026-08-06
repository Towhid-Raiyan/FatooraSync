# FatooraSync — MVP Design Spec

**Status:** IN PROGRESS — paused mid-brainstorming, safe to resume (see [Resume Point](#resume-point))
**Last updated:** 2026-08-06
**Process:** Following the `superpowers:brainstorming` skill. Do not skip to implementation/coding until this doc is fully drafted, self-reviewed, and explicitly approved by the user, then handed to `superpowers:writing-plans`.

## 1. Vision

FatooraSync is a cloud-based, multi-tenant POS/business-management SaaS for SMEs (grocery, chocolate, hardware, retail, electronics, pharmacy shops), launching in Saudi Arabia with planned future expansion to UAE, Qatar, Kuwait, Bahrain, Oman. Core philosophy: simplicity, speed, zero learning curve, bilingual (Arabic-first, full RTL) + English, enterprise-grade reliability under the hood. Long-term (post-MVP) goal: offline-capable local+cloud hybrid sync. Full original vision brief is preserved in project conversation history; this doc captures the distilled, decided design.

## 2. MVP Scope — APPROVED

**In scope for this design/build cycle:**
- Auth & tenant onboarding (single owner login per business; tenants provisioned manually — no self-serve payment signup)
- Customers: CRUD, name/VAT-ID autocomplete, default "Walk-in Customer", auto-create customer when a receipt is saved with a new VAT ID
- Products: CRUD, barcode/SKU/name autocomplete, quick-create modal from the receipt screen, per-product VAT override (see §4)
- Sales Receipt: line items, real-time subtotal/VAT/total, stock decrement on save, **immutable once saved**, ZATCA-ready fields populated (no live ZATCA API call yet), bilingual (AR+EN) print output
- Quotation: same engine as Sales Receipt, no ZATCA fields, document clearly labeled "Quotation"
- Sales History / Quotation History: searchable, filterable
- System Settings: default VAT %, language

**Explicitly out of scope for MVP** (architecture must not preclude adding these later): Inventory (restock/adjustments/low-stock alerts), Purchase Orders, Suppliers, Expenses, Employee/staff roles & permissions, Accounting, CRM/Loyalty, Multi-store/multi-branch, ZATCA Phase-2 live API integration, Credit Note/Returns *workflow* (data relationship reserved now, UI/flow later), offline/local hybrid client, payment gateway, multi-currency.

**Design principles that keep those doors open** (already binding on the MVP build, not deferred):
- Every tenant-scoped table carries `tenant_id` from day one — required for future multi-store and for keeping tenant isolation retrofit-free.
- `Receipt` has a nullable self-reference (`credit_note_of_receipt_id`) reserved now, unused until returns ship.
- `Product.quantity` is a plain counter now; a future Inventory module adds stock *movements* (ledger) that derive the same counter — no field rename needed later.
- API routes are organized by resource, not entangled in page/component code, so a future dedicated backend extraction or an offline client has a clean contract to consume.

## 3. Requirements Review — Resolved Decisions

| Area | Decision | Rationale / notes |
|---|---|---|
| Team & stack | Solo builder, no stack lock-in | Drives lean architecture choice |
| Offline/hybrid sync | Cloud-only for MVP | Full offline-first is a large separate effort; data model must not block it later |
| ZATCA compliance | Data model ZATCA-Phase-1-ready now (UUID, invoice hash, QR/TLV fields); actual QR generation + Phase-2 API integration deferred | Cheap to design in now, expensive to retrofit |
| Staff roles | Single login per tenant for MVP | Schema allows staff roles/permissions later |
| Printing | Browser/PDF first; print pipeline abstracted (print service concept) so thermal ESC/POS can be added later | Avoids native/local-agent complexity in MVP |
| Billing/payments | No payment gateway in MVP; tenants provisioned manually | Keeps MVP scope to the product itself, not subscription commerce |
| Hosting | Bootstrap-lean; managed platforms over self-managed infra | Solo operator, 1–3 month timeline |
| Stock deduction | Sales Receipt decrements `Product.quantity` (simple counter) | "Initial Quantity" field is otherwise meaningless; full Inventory module later |
| Receipt mutability | **Immutable once saved.** Returns/corrections handled later via a linked **credit note** (new document referencing the original invoice's UUID, reversing VAT) — not by editing/deleting the original | Matches Saudi return/refund practice and ZATCA credit-note pattern; data relationship reserved now (§2), workflow built later |
| Timeline | 1–3 months to first pilot business | Favors lean, low-ceremony architecture over maximal separation |
| Auth method | Email + password | Simpler to build correctly than phone/OTP (SMS provider integration deferred) |
| Print language | Bilingual (AR + EN) on every printed receipt, regardless of active UI language | Standard for KSA retail; avoids ambiguity for mixed customer bases |
| VAT granularity | **Per-product VAT rate/exemption**, defaulting to the tenant's global VAT setting | Real KSA grocery/pharmacy baskets mix standard-rated and zero-rated/exempt items; retrofitting later touches receipt totals, ZATCA fields, and historical reports |

## 4. Assumptions (stated, not yet challenged by user)

1. **Currency:** SAR only for MVP; multi-currency deferred to GCC expansion.
2. **Locations:** one location per tenant in MVP (multi-store is explicitly future).
3. **Units of measure:** fixed predefined list (Piece, KG, Box, Carton, Liter, etc.), not user-customizable in MVP.

## 5. Architecture Decision — APPROVED

**Chosen: Option A — Next.js full-stack monolith.**

- TypeScript, Next.js (App Router) for UI + API (route handlers)
- PostgreSQL, tenant-scoped via `tenant_id` on every tenant table + Postgres Row-Level Security as a defense-in-depth backstop against app-layer isolation bugs
- Prisma or Drizzle ORM (final pick pending — not yet decided)
- Auth.js for email/password auth
- `next-intl` for AR/EN + RTL
- Deployment: Vercel + managed Postgres (Neon or Supabase — final pick pending)

**Why (over decoupled API+SPA, and over Laravel+Filament):** fastest path for a solo builder on a 1–3 month timeline; one language, one deploy target, huge ecosystem. Next.js route handlers are a real, isolated API surface (not tangled into page rendering), so extracting a dedicated backend later — when the offline/hybrid-sync client is actually built — is additive, not a rewrite. Laravel+Filament was a legitimate alternative (mature multi-tenancy package, strong regional ecosystem fit) but wasn't chosen since the user has no existing PHP preference and Option A is equally fast with less new-language risk.

Two picks explicitly deferred to implementation planning: Prisma vs. Drizzle, Neon vs. Supabase. Neither is architecturally significant enough to block continuing the design.

## Resume Point

This document was paused after approving §2 (MVP Scope) and the architecture decision in §5, mid-way through the `superpowers:brainstorming` design-presentation step. **Not yet presented or approved:**

- Multi-tenancy & core data model detail (entities, relationships, indexing approach beyond the principles already stated in §2)
- Auth, i18n/RTL, ZATCA-readiness fields, and print-pipeline detail (cross-cutting concerns, one design section)
- Non-functional posture for MVP: testing strategy, observability/logging, CI/CD readiness (kept minimal/appropriate for a solo 1–3 month build, not enterprise-scale ceremony)

**Next steps when resuming:**
1. Present the remaining design sections above, one at a time, per `superpowers:brainstorming`.
2. Run the spec self-review checklist (placeholders, internal consistency, scope, ambiguity).
3. Ask the user to review this file directly.
4. Only then invoke `superpowers:writing-plans` to produce an implementation plan. Do not write product code before that.

No decisions above are final until the user reviews this whole file — treat §2–§5 as "approved so far, subject to the final full-document review," not as frozen.
