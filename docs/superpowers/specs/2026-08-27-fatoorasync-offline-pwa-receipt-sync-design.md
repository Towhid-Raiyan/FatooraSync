# FatooraSync — Offline PWA & Receipt Sync — Design Spec

**Status:** Approved
**Last updated:** 2026-08-27

## 1. Purpose

FatooraSync today has no offline capability at all: every page is a server component that fetches via Prisma at render time, and every save is a network round-trip to an API route. If a cashier's internet drops mid-shift, they can't open New Receipt, can't complete a sale, and are stuck until connectivity returns — a real business risk for retail clients who can't tell a customer "come back later."

This spec adds a scoped offline mode for the one flow where getting stuck actually costs money: creating a Sales Receipt or Quotation. It does not attempt to make the whole app offline-capable.

This was anticipated in the original MVP design: *"The long-term vision includes an offline-capable local+cloud hybrid sync client, deliberately deferred out of MVP... never design a table or API route that assumes single-tenant or couples business logic into page/component code — keep the resource/API layer extractable."* This spec is that hybrid client, scoped to the sale flow.

## 2. Scope

**In scope:**
- `/receipts/new` and `/quotations/new` work fully offline: load with cached data, create a sale, print it, and have it sync automatically once connectivity returns.
- PWA installability (manifest, icons, "Add to Home Screen" / desktop install) for the whole app.
- A minimal service worker precaching just the app shell needed to boot those two pages offline.
- Final, non-colliding, immediately-usable invoice/quotation numbers even while offline, via per-device number leasing.
- A visible offline/pending-sync status indicator.

**Explicitly out of scope / deliberately deferred:**
- **Every other page** (Inventory, Statistics, Suppliers, Settings, Users, Products/Customers management, receipt/quotation history). These stay exactly as they are today — server components, no offline fallback. Opening them while offline simply fails to load, same as today.
- **Offline catalog editing** (adding/editing products or customers while offline). Only *using* the already-cached catalog to build a sale is supported.
- **Strict gapless invoice numbering.** Numbers are always unique, never reused, and monotonically increasing per device, but a device that leases a block and never finishes it (lost/broken hardware) leaves a permanent small gap. See §4.1.
- **Cross-device chronological ordering.** Two simultaneously-active offline devices can have their synced receipts land on the server in a different order than they were actually created in. See §4.1 and §7.
- **Adopting a general-purpose local-first sync engine** (PowerSync/ElectricSQL/RxDB). Considered and rejected — see the conversation record; the app already hit a hard Neon `BYPASSRLS` wall trying Postgres RLS for tenant isolation, and a broad sync engine would re-fight that constraint for a problem this narrow. Hand-rolled cache + outbox is deliberately smaller and fully within the existing `withTenant()` model.

## 3. Data model

```prisma
model NumberLease {
  id            String       @id @default(uuid())
  tenantId      String
  tenant        Tenant       @relation(fields: [tenantId], references: [id])
  deviceId      String       // client-generated UUID, stored in the device's localStorage
  documentType  DocumentType // SALES_RECEIPT | QUOTATION
  rangeStart    Int
  rangeEnd      Int          // inclusive
  nextToIssue   Int          // next unused number in [rangeStart, rangeEnd]
  leasedAt      DateTime     @default(now())

  @@index([tenantId, deviceId, documentType])
}
```

No changes to `Document`, `Tenant`, or any other existing model. `Tenant.nextSalesReceiptNumber` / `nextQuotationNumber` remain the single source of truth for "the next unallocated number" — leasing just reserves a block of them atomically instead of incrementing one at a time.

`Document.number` (already `Int`, already how receipts/quotations are numbered today) accepts a pre-assigned value when a synced-from-offline receipt is saved, instead of always being auto-assigned server-side at save time.

## 4. Core mechanisms

### 4.1 Number leasing

A device leases a block of numbers from the server whenever it's online and running low, then issues from that block locally with no further server contact:

1. On `/receipts/new` / `/quotations/new`, if the device holds fewer than 5 unused leased numbers for that document type, it calls `POST /api/receipts/lease-numbers` (and the quotation equivalent). This atomically reads and bumps `Tenant.nextSalesReceiptNumber` by 20 inside a transaction, creates a `NumberLease` row, and returns `{ rangeStart, rangeEnd }` to the device.
2. The device stores the lease in Dexie and issues numbers from `nextToIssue` upward — online or offline, it doesn't matter, since issuing a number never requires a server call once leased.
3. When a lease is exhausted (`nextToIssue > rangeEnd`), the device requests a fresh one the next time it's online. If it's *still* offline at that point, further sales queue in the outbox without a final number yet, clearly marked "will be numbered on reconnect" — the one case where "final immediately" can't be honored, kept rare by refilling well before exhaustion under normal use.

**Consequence, stated explicitly:** if a device leases 20 numbers, uses 3, then is lost or never reconnects, the remaining 17 are permanently skipped — never issued to anyone, ever. Numbers stay unique and strictly increasing per device; they are not guaranteed gapless tenant-wide. This is the direct, agreed tradeoff for "final immediately" (see conversation record) — analogous to void/blank checks in a paper checkbook, not a data-integrity problem.

**Interaction with the existing ZATCA-readiness hash chain:** `computeInvoiceHash()` (`src/lib/zatca/hash-chain.ts`) chains each receipt's hash to `Tenant.lastSalesReceiptHash` in **server-write order**, not invoice-number order — this is already true today, independent of this feature. An offline device's receipts #5–7 syncing *after* another device has already written #26 online will chain after #26's hash, even though they carry lower numbers. This is the same "generated vs. submitted order" gap already documented in the domain-decisions memory as an accepted Phase-1 limitation; offline sync makes it an actively-exercised case instead of a theoretical one, but does not introduce a new flaw. Real chronological handling is Phase-2 ZATCA work, already known to be deferred.

### 4.2 Local cache

- Dexie (IndexedDB) tables: `products`, `customers`, `settings`, keyed by tenant, mirroring exactly the data `/receipts/new` and `/quotations/new` already fetch server-side today (`Product`, `Customer`, `Settings` — same fields, `Decimal` fields pre-serialized to strings as the pages already do).
- `/receipts/new` and `/quotations/new` change from server components to client components for their data-fetching: they call a small API route for this data, and — as a side effect of every successful load — mirror the result into Dexie. No separate background sync job; normal usage keeps the cache warm.
- If offline, the same components read straight from Dexie instead. Same URL, same UI — the cashier doesn't need to know or do anything differently.
- **Staleness is accepted, not solved**: an offline sale uses whatever prices/customers were cached the last time this device was online. No live stock check blocks a sale today either, so this doesn't introduce a new failure mode — see §7.

### 4.3 Outbox & sync

1. Save still tries the real `POST /api/receipts` (or `/api/quotations`) first. Success → behaves exactly as today.
2. On a network failure specifically (not a validation 400), the client pulls the next leased number, writes a full record with a client-generated UUID to Dexie's `pendingReceipts` outbox, and renders/prints immediately from that local data. The cashier's experience is identical either way — "Saved," receipt in hand.
3. A background listener — the browser `online` event, plus a ~30s retry loop while the outbox is non-empty — replays queued items against the real endpoint in creation order. Each carries its client UUID as an idempotency key: if a request actually succeeded but the response was lost, a retry recognizes the UUID already exists server-side and no-ops instead of double-creating.
4. A header status indicator shows "Offline — N sales pending sync" whenever the outbox is non-empty, so the state is never invisible to the cashier.

## 5. API

- `POST /api/receipts/lease-numbers`, `POST /api/quotations/lease-numbers` — new. Body: none (device identified via a `X-Device-Id` header). Response: `{ rangeStart, rangeEnd }`. Atomically bumps the relevant `Tenant.next*Number` counter and creates the `NumberLease` row, scoped by `withTenant()` like every other tenant-scoped route.
- `POST /api/receipts`, `POST /api/quotations` — modified, not replaced. Accepts an optional pre-assigned `number` + client UUID in the body. When present, the handler validates the number falls inside a `NumberLease` this device owns and hasn't exceeded, then saves with that number instead of auto-incrementing. When absent (today's normal online flow), behavior is unchanged.
- `GET /api/receipts/offline-data`, `GET /api/quotations/offline-data` — new, thin wrappers returning exactly the `customers`/`products`/`settings` payload the pages already fetch server-side, for the client-side cache-mirroring described in §4.2.
- `GET /api/health` — new, trivial endpoint used only for real connectivity detection (see §6), not business data.

## 6. PWA & service worker

- `manifest.json`: app name, icons generated from the existing favicon asset, theme color matching the current palette, `display: "standalone"`.
- Hand-rolled service worker (not `next-pwa`, which has known Turbopack friction in this repo's build), registered in production builds only. Precaches only the JS/CSS/layout chrome needed to boot `/receipts/new` and `/quotations/new` with zero network — not the rest of the app, matching the scope in §2.
- New-version handling: a changed deploy changes precached bundle hashes, which the service worker detects; shows a non-intrusive "Update available — refresh" prompt rather than force-reloading mid-sale.
- Connectivity detection combines `navigator.onLine` (unreliable alone — can read "online" on a connected-but-server-unreachable network) with a periodic ping to `/api/health` to decide the real online/offline state driving the outbox and status indicator.

## 7. Error handling & edge cases

- **Brand-new device, never been online**: can't create an offline sale (no lease yet). Unavoidable — it also couldn't have logged in for the first time without internet.
- **Lease exhausted while offline**: covered in §4.1 — the one case where a number isn't final immediately.
- **Duplicate/partial sync**: covered in §4.3 — client UUID as idempotency key.
- **Auth expiry mid-offline**: the cached JWT session drives offline requests; if it's expired by the time sync runs, sync retries surface "please log in again to finish syncing N sales" rather than silently dropping the queued items.
- **Stock during offline sales**: no change to `applyStockMovement()` — offline receipts sync through the exact same save path as online ones, including its stock-decrement logic. Two devices offline simultaneously selling the last unit of the same product can drive stock negative once both sync; this surfaces the same way an online overselling race would (visible in Inventory/low-stock banner), not as a rejected or reversed sale — a completed, printed, immutable receipt is never undone for a stock conflict.

## 8. Testing

- Unit tests: number-leasing allocation/exhaustion and concurrent-lease non-overlap; outbox replay dedup via UUID and retry/backoff.
- Integration tests (existing Vitest + Neon setup): `lease-numbers` routes, and `/api/receipts` + `/api/quotations` accepting a pre-assigned number within vs. outside an owned lease.
- Manual verification: real airplane-mode session — load the page online, disconnect, create and print a receipt, reconnect, confirm it syncs with the pre-assigned number and the outbox indicator clears. This path can't be fully covered by automated tests and will be checked live in-browser before considering this done, per this project's usual verification standard.
