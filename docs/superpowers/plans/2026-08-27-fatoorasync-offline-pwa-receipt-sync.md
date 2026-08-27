# FatooraSync Offline PWA & Receipt Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cashier create, print, and hand over a Sales Receipt or Quotation with zero internet connectivity, with the sale syncing to the cloud database automatically once the device reconnects — using a final, non-colliding invoice number from the moment it's printed.

**Architecture:** A hand-rolled local cache + outbox, not a general-purpose sync engine (rejected in the spec — see §2). `/receipts/new` and `/quotations/new` become client-fetched pages backed by a Dexie (IndexedDB) mirror of products/customers/settings/tenant info. Saves try the network first; on failure they draw a pre-leased final invoice number, write to a Dexie outbox, print immediately from local data, and replay against the existing save endpoints once online. A minimal hand-rolled service worker (not `next-pwa` — Turbopack friction) makes the app installable and lets those two routes load with zero network.

**Tech Stack:** Next.js 15 (App Router) + Prisma/Postgres (Neon) + Dexie (new dependency) + a hand-rolled Service Worker. No new backend infra.

**Spec:** [docs/superpowers/specs/2026-08-27-fatoorasync-offline-pwa-receipt-sync-design.md](../specs/2026-08-27-fatoorasync-offline-pwa-receipt-sync-design.md)

## Global Constraints

- Scope is exactly `/receipts/new` and `/quotations/new`. Every other page stays untouched — no offline fallback anywhere else.
- Numbers issued offline are final immediately (never renumbered on sync) — see spec §4.1. A device that leases a block and never finishes it leaves a permanent, accepted gap.
- Tenant isolation stays entirely at the application layer via `withTenant()` (`src/lib/db/tenant-context.ts`) or, inside a `prisma.$transaction`, by manually stamping `tenantId` on every query exactly as `src/app/api/receipts/route.ts` already does — Postgres RLS is not usable on Neon (every role carries `BYPASSRLS`), so there is no database-level backstop.
- No new heavy dependency beyond Dexie (~25kb). `next-pwa` is explicitly rejected — known Turbopack friction in this repo's build (`next build --turbopack`).
- Every new/modified DB-touching Vitest test needs `{ timeout: 30000 }` per `it()` — this project's convention for real Neon network round-trips (default 5000ms is too short).
- All new UI text goes through the existing i18n dictionary system (`src/lib/i18n/dictionaries/{en,ar}.ts` + `dictionary.types.ts`), matching every other tenant-facing screen.

---

### Task 1: `NumberLease` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_number_lease/migration.sql` (generated, not hand-written)

**Interfaces:**
- Produces: `NumberLease` Prisma model — `{ id, tenantId, deviceId, documentType, rangeStart, rangeEnd, nextToIssue, leasedAt }`, used by Task 3's lease-allocation helper and Task 4/5's number-validation logic.

- [ ] **Step 1: Add the model to the schema**

Add this block to `prisma/schema.prisma`, near the other tenant-scoped models (e.g. after `StockMovement`):

```prisma
model NumberLease {
  id           String       @id @default(uuid())
  tenantId     String
  tenant       Tenant       @relation(fields: [tenantId], references: [id])
  deviceId     String
  documentType DocumentType
  rangeStart   Int
  rangeEnd     Int
  nextToIssue  Int
  leasedAt     DateTime     @default(now())

  @@index([tenantId, deviceId, documentType])
}
```

Add the reverse relation to `Tenant` alongside its other list relations:

```prisma
  numberLeases NumberLease[]
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_number_lease`
Expected: a new folder under `prisma/migrations/` containing a `CREATE TABLE "NumberLease" ...` statement, applied to the local dev database without error.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: exits 0; `@prisma/client` now exports a `NumberLease` type.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add NumberLease model for offline invoice number leasing"
```

---

### Task 2: Make `buildZatcaQrPayload` isomorphic (Buffer → Uint8Array)

The offline print path (Task 12) needs to build the same ZATCA QR payload in the browser, where Node's `Buffer` global isn't available in a Turbopack client bundle. This rewrites the existing function to produce byte-identical output using only `TextEncoder`/`Uint8Array`/`btoa`, which work in both Node and the browser — no behavior change for any existing caller.

**Files:**
- Modify: `src/lib/zatca/qr-payload.ts`
- Test: `src/lib/zatca/qr-payload.test.ts` (new — this file has no test today)

**Interfaces:**
- Produces: `buildZatcaQrPayload(input: QrPayloadInput): string` — same signature and output as today, now callable from client code (used by Task 12).

- [ ] **Step 1: Write the failing test**

Create `src/lib/zatca/qr-payload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildZatcaQrPayload } from "./qr-payload";

describe("buildZatcaQrPayload", () => {
  it("matches the known-good Phase-1 TLV/Base64 output for a simple invoice", () => {
    const result = buildZatcaQrPayload({
      sellerName: "Acme Retail",
      vatNumber: "300000000000003",
      timestamp: "2026-08-27T10:00:00.000Z",
      invoiceTotal: "115.00",
      vatTotal: "15.00",
    });
    // Same fixed input as this function has always accepted -- this value is
    // computed once from the pre-refactor Buffer-based implementation and
    // pinned here so the Uint8Array rewrite can't silently change output.
    expect(result).toBe(
      Buffer.concat([
        Buffer.from([1, 11]), Buffer.from("Acme Retail", "utf8"),
        Buffer.from([2, 15]), Buffer.from("300000000000003", "utf8"),
        Buffer.from([3, 24]), Buffer.from("2026-08-27T10:00:00.000Z", "utf8"),
        Buffer.from([4, 6]), Buffer.from("115.00", "utf8"),
        Buffer.from([5, 5]), Buffer.from("15.00", "utf8"),
      ]).toString("base64")
    );
  });

  it("throws when a field exceeds the 255-byte TLV length limit", () => {
    expect(() =>
      buildZatcaQrPayload({
        sellerName: "x".repeat(256),
        vatNumber: "300000000000003",
        timestamp: "2026-08-27T10:00:00.000Z",
        invoiceTotal: "1.00",
        vatTotal: "0.15",
      })
    ).toThrow(/255-byte/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/zatca/qr-payload.test.ts`
Expected: FAIL — the file has no current bug, so this step should actually PASS against the existing Buffer-based implementation. That's fine: it confirms the pinned fixture is correct *before* the rewrite, so Step 4 has something real to protect. Confirm it passes here, then proceed to the rewrite.

- [ ] **Step 3: Rewrite `buildZatcaQrPayload` without `Buffer`**

Replace the full contents of `src/lib/zatca/qr-payload.ts`:

```ts
export interface QrPayloadInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string; // ISO 8601
  invoiceTotal: string;
  vatTotal: string;
}

const textEncoder = new TextEncoder();

function encodeTlv(tag: number, value: string): Uint8Array {
  const valueBytes = textEncoder.encode(value);
  if (valueBytes.length > 255) {
    throw new Error(`ZATCA QR field for tag ${tag} exceeds the 255-byte TLV length limit`);
  }
  const out = new Uint8Array(2 + valueBytes.length);
  out[0] = tag;
  out[1] = valueBytes.length;
  out.set(valueBytes, 2);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa is a browser/Node-both global as of Node 18+ (this project's floor,
  // confirmed via next.config.ts's supported runtime) -- no polyfill needed.
  return btoa(binary);
}

// Standard ZATCA Phase-1 simplified-invoice QR structure: 5 TLV (Tag-Length-Value)
// fields concatenated in tag order, then Base64-encoded as a whole. Pure local
// computation, no external ZATCA API dependency. Deliberately Buffer-free so it
// can also run in a browser bundle (the offline print path calls this
// client-side -- see src/lib/offline/print-data.ts).
export function buildZatcaQrPayload(input: QrPayloadInput): string {
  const tlvs = [
    encodeTlv(1, input.sellerName),
    encodeTlv(2, input.vatNumber),
    encodeTlv(3, input.timestamp),
    encodeTlv(4, input.invoiceTotal),
    encodeTlv(5, input.vatTotal),
  ];
  const totalLength = tlvs.reduce((sum, t) => sum + t.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const t of tlvs) {
    combined.set(t, offset);
    offset += t.length;
  }
  return bytesToBase64(combined);
}
```

- [ ] **Step 4: Run the test to verify it still passes**

Run: `npx vitest run src/lib/zatca/qr-payload.test.ts`
Expected: PASS — both tests, confirming byte-identical output to the old Buffer-based version.

- [ ] **Step 5: Run the full existing ZATCA-related suite to check for regressions**

Run: `npx vitest run src/app/api/receipts/route.test.ts`
Expected: PASS — this route calls `buildZatcaQrPayload` indirectly via the receipt save flow; a passing run confirms the rewrite didn't change real invoice QR output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zatca/qr-payload.ts src/lib/zatca/qr-payload.test.ts
git commit -m "Make buildZatcaQrPayload isomorphic so it can run client-side"
```

---

### Task 3: Shared lease-block helper + `/api/receipts/lease-numbers` + `/api/quotations/lease-numbers`

**Files:**
- Create: `src/lib/receipts/lease-block.ts`
- Create: `src/app/api/receipts/lease-numbers/route.ts`
- Create: `src/app/api/receipts/lease-numbers/route.test.ts`
- Create: `src/app/api/quotations/lease-numbers/route.ts`
- Create: `src/app/api/quotations/lease-numbers/route.test.ts`

**Interfaces:**
- Produces: `leaseNumberBlock(tenantId: string, deviceId: string, documentType: "SALES_RECEIPT" | "QUOTATION", blockSize: number): Promise<{ rangeStart: number; rangeEnd: number }>` — used by both new routes here, and referenced by Task 4/5's validation logic (which reads `NumberLease` rows this creates).
- Consumes: `Tenant.nextSalesReceiptNumber` / `Tenant.nextQuotationNumber` (existing counters, unchanged), `prisma` (`src/lib/db/client.ts`).

- [ ] **Step 1: Write the failing unit test for the helper**

Create `src/lib/receipts/lease-block.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { leaseNumberBlock } from "./lease-block";

let tenantId: string;

describe("leaseNumberBlock", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Lease Test Co", tradeNameEn: "Lease Test Shop", vatNumber: "300000000000123" },
    });
    tenantId = tenant.id;
  }, 30000);

  afterAll(async () => {
    await prisma.numberLease.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("reserves a contiguous block starting from the tenant's current counter", { timeout: 30000 }, async () => {
    const block = await leaseNumberBlock(tenantId, "device-a", "SALES_RECEIPT", 20);
    expect(block).toEqual({ rangeStart: 1, rangeEnd: 20 });

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.nextSalesReceiptNumber).toBe(21);
  });

  it("never overlaps a second lease, even for a different device", { timeout: 30000 }, async () => {
    const first = await leaseNumberBlock(tenantId, "device-a", "QUOTATION", 20);
    const second = await leaseNumberBlock(tenantId, "device-b", "QUOTATION", 20);
    expect(second.rangeStart).toBe(first.rangeEnd + 1);
  });

  it("keeps SALES_RECEIPT and QUOTATION counters independent", { timeout: 30000 }, async () => {
    const receiptBlock = await leaseNumberBlock(tenantId, "device-c", "SALES_RECEIPT", 5);
    const quotationBlock = await leaseNumberBlock(tenantId, "device-c", "QUOTATION", 5);
    // Independent counters -- no reason for these ranges to be related, just
    // confirming both succeed and persist as separate NumberLease rows.
    const leases = await prisma.numberLease.findMany({ where: { tenantId, deviceId: "device-c" } });
    expect(leases).toHaveLength(2);
    expect(leases.find((l) => l.documentType === "SALES_RECEIPT")?.rangeStart).toBe(receiptBlock.rangeStart);
    expect(leases.find((l) => l.documentType === "QUOTATION")?.rangeStart).toBe(quotationBlock.rangeStart);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/receipts/lease-block.test.ts`
Expected: FAIL with "Cannot find module './lease-block'" (file doesn't exist yet).

- [ ] **Step 3: Implement the helper**

Create `src/lib/receipts/lease-block.ts`:

```ts
import type { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/db/client";

const COUNTER_FIELD: Record<DocumentType, "nextSalesReceiptNumber" | "nextQuotationNumber"> = {
  SALES_RECEIPT: "nextSalesReceiptNumber",
  QUOTATION: "nextQuotationNumber",
};

// Atomically reserves the next `blockSize` numbers for one device, so it can
// issue final invoice/quotation numbers offline with zero further server
// contact. Uses the *same* Tenant.next*Number counters the online save path
// already increments one at a time (src/app/api/receipts/route.ts,
// src/app/api/quotations/route.ts) -- leasing a block of 20 is equivalent to
// 20 sequential single-number reservations, just claimed up front.
export async function leaseNumberBlock(
  tenantId: string,
  deviceId: string,
  documentType: DocumentType,
  blockSize: number
): Promise<{ rangeStart: number; rangeEnd: number }> {
  const field = COUNTER_FIELD[documentType];
  return prisma.$transaction(async (txn) => {
    const tenant = await txn.tenant.update({
      where: { id: tenantId },
      data: { [field]: { increment: blockSize } },
      select: { [field]: true },
    });
    const nextAfter = tenant[field] as number;
    const rangeStart = nextAfter - blockSize;
    const rangeEnd = nextAfter - 1;

    await txn.numberLease.create({
      data: { tenantId, deviceId, documentType, rangeStart, rangeEnd, nextToIssue: rangeStart },
    });

    return { rangeStart, rangeEnd };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/receipts/lease-block.test.ts`
Expected: PASS — all 3 tests.

- [ ] **Step 5: Write the failing route test for receipts**

Create `src/app/api/receipts/lease-numbers/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { POST } from "./route";

let tenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function req(deviceId: string | null) {
  const headers = new Headers();
  if (deviceId) headers.set("X-Device-Id", deviceId);
  return new Request("http://localhost/api/receipts/lease-numbers", { method: "POST", headers });
}

describe("/api/receipts/lease-numbers", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Lease Route Co", tradeNameEn: "Lease Route Shop", vatNumber: "300000000000456" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
  }, 30000);

  afterAll(async () => {
    await prisma.numberLease.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns a leased range for a valid device id", { timeout: 30000 }, async () => {
    const response = await POST(req("device-x"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rangeStart).toBe(1);
    expect(body.rangeEnd).toBe(20);
  });

  it("returns 400 when X-Device-Id is missing", { timeout: 30000 }, async () => {
    const response = await POST(req(null));
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(req("device-x"));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/app/api/receipts/lease-numbers/route.test.ts`
Expected: FAIL with "Cannot find module './route'".

- [ ] **Step 7: Implement the receipts route**

Create `src/app/api/receipts/lease-numbers/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { leaseNumberBlock } from "@/lib/receipts/lease-block";

const BLOCK_SIZE = 20;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const deviceId = request.headers.get("X-Device-Id");
  if (!deviceId) {
    return NextResponse.json({ error: "X-Device-Id header is required" }, { status: 400 });
  }

  const block = await leaseNumberBlock(tenantId, deviceId, "SALES_RECEIPT", BLOCK_SIZE);
  return NextResponse.json(block, { status: 200 });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/app/api/receipts/lease-numbers/route.test.ts`
Expected: PASS — all 3 tests.

- [ ] **Step 9: Repeat Steps 5-8 for quotations**

Create `src/app/api/quotations/lease-numbers/route.test.ts` — identical to the receipts version above with these substitutions: URL `http://localhost/api/quotations/lease-numbers`, tenant `vatNumber: "300000000000789"`, `tradeNameEn: "Lease Route Quotation Shop"`.

Create `src/app/api/quotations/lease-numbers/route.ts` — identical to the receipts route above except `"SALES_RECEIPT"` becomes `"QUOTATION"`.

Run: `npx vitest run src/app/api/quotations/lease-numbers/route.test.ts`
Expected: PASS — all 3 tests.

- [ ] **Step 10: Commit**

```bash
git add src/lib/receipts/lease-block.ts src/lib/receipts/lease-block.test.ts src/app/api/receipts/lease-numbers src/app/api/quotations/lease-numbers
git commit -m "Add number-leasing endpoints for offline invoice numbering"
```

---

### Task 4: `/api/receipts` accepts a pre-assigned number from an owned lease

**Files:**
- Modify: `src/app/api/receipts/route.ts`
- Modify: `src/app/api/receipts/route.test.ts`

**Interfaces:**
- Consumes: `NumberLease` (Task 1), the existing `document` transaction block in this file.
- Produces: the POST handler now accepts an optional `{ preAssigned: { number: number, uuid: string }, deviceId: string }` in the request body — used by Task 13's offline outbox replay.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/api/receipts/route.test.ts` (find the existing `describe("/api/receipts", ...)` block and add these `it`s inside it — check the top of the file first for its existing `tenantId`/product/customer setup fixtures and reuse them):

```ts
  it("saves with a pre-assigned number when it falls inside an owned lease", { timeout: 30000 }, async () => {
    const leased = await prisma.$transaction(async (txn) => {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: 20 } },
        select: { nextSalesReceiptNumber: true },
      });
      const rangeEnd = tenant.nextSalesReceiptNumber - 1;
      const rangeStart = rangeEnd - 19;
      await txn.numberLease.create({
        data: { tenantId, deviceId: "device-lease-test", documentType: "SALES_RECEIPT", rangeStart, rangeEnd, nextToIssue: rangeStart },
      });
      return rangeStart;
    });

    const request = new Request("http://localhost/api/receipts", {
      method: "POST",
      headers: { "X-Device-Id": "device-lease-test" },
      body: JSON.stringify({
        customer: {},
        lines: [{ productId, quantity: 1 }],
        preAssigned: { number: leased, uuid: "11111111-1111-1111-1111-111111111111" },
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.number).toBe(leased);
  });

  it("rejects a pre-assigned number outside any lease this device owns", { timeout: 30000 }, async () => {
    const request = new Request("http://localhost/api/receipts", {
      method: "POST",
      headers: { "X-Device-Id": "device-with-no-lease" },
      body: JSON.stringify({
        customer: {},
        lines: [{ productId, quantity: 1 }],
        preAssigned: { number: 999999, uuid: "22222222-2222-2222-2222-222222222222" },
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
  });

  it("returns the existing document, not a duplicate, on a retried uuid", { timeout: 30000 }, async () => {
    const leased = await prisma.$transaction(async (txn) => {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: 20 } },
        select: { nextSalesReceiptNumber: true },
      });
      const rangeEnd = tenant.nextSalesReceiptNumber - 1;
      const rangeStart = rangeEnd - 19;
      await txn.numberLease.create({
        data: { tenantId, deviceId: "device-retry-test", documentType: "SALES_RECEIPT", rangeStart, rangeEnd, nextToIssue: rangeStart },
      });
      return rangeStart;
    });
    const body = {
      customer: {},
      lines: [{ productId, quantity: 1 }],
      preAssigned: { number: leased, uuid: "33333333-3333-3333-3333-333333333333" },
    };
    const makeRequest = () =>
      new Request("http://localhost/api/receipts", {
        method: "POST",
        headers: { "X-Device-Id": "device-retry-test" },
        body: JSON.stringify(body),
      });

    const first = await POST(makeRequest());
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await POST(makeRequest());
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/receipts/route.test.ts`
Expected: FAIL — the 3 new tests fail (409 test currently 201s since nothing validates `preAssigned` yet; the other two fail on assertions about `preAssigned` being honored).

- [ ] **Step 3: Modify the route to honor `preAssigned` + `uuid` idempotency**

In `src/app/api/receipts/route.ts`, add a case-branch near the top of `POST`, right after `const body = await request.json();` (around line 38):

```ts
  const deviceId = request.headers.get("X-Device-Id");
  const preAssigned = body.preAssigned as { number: number; uuid: string } | undefined;
```

Then, inside the `prisma.$transaction` callback, right after `const settings = await txn.settings.findUniqueOrThrow(...)` (around line 112), add the idempotency short-circuit:

```ts
      if (preAssigned?.uuid) {
        const existing = await txn.document.findFirst({
          where: { tenantId, uuid: preAssigned.uuid },
          include: { lines: true },
        });
        if (existing) {
          return { existing, isRetry: true } as const;
        }
      }
```

This changes the transaction's return shape, so wrap the rest of the existing transaction body's final `return created;` (the last line before the closing `}, { timeout: ... })`) as `return { existing: created, isRetry: false } as const;` instead, and update every internal reference to `created` to keep using the local `created` variable as before -- only the final `return` statement changes.

Now replace the number-assignment block (the `tenantCounters`/`number`/`previousInvoiceHash` block around lines 167-181) with a branch that either validates `preAssigned` against an owned lease, or falls back to the existing counter-increment:

```ts
      let number: number;
      let previousInvoiceHash: string;
      if (preAssigned) {
        if (!deviceId) {
          throw new ReceiptError("X-Device-Id header is required with a pre-assigned number", 400);
        }
        const lease = await txn.numberLease.findFirst({
          where: {
            tenantId,
            deviceId,
            documentType: "SALES_RECEIPT",
            rangeStart: { lte: preAssigned.number },
            rangeEnd: { gte: preAssigned.number },
          },
        });
        if (!lease) {
          throw new ReceiptError("This number was not leased to your device", 409);
        }
        const alreadyUsed = await txn.document.findFirst({ where: { tenantId, type: "SALES_RECEIPT", number: preAssigned.number } });
        if (alreadyUsed) {
          throw new ReceiptError("This number has already been used", 409);
        }
        number = preAssigned.number;
        const tenantForHash = await txn.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { lastSalesReceiptHash: true } });
        previousInvoiceHash = tenantForHash.lastSalesReceiptHash ?? GENESIS_HASH;
      } else {
        const tenantCounters = await txn.tenant.update({
          where: { id: tenantId },
          data: { nextSalesReceiptNumber: { increment: 1 } },
          select: { nextSalesReceiptNumber: true, lastSalesReceiptHash: true },
        });
        number = tenantCounters.nextSalesReceiptNumber - 1;
        previousInvoiceHash = tenantCounters.lastSalesReceiptHash ?? GENESIS_HASH;
      }
```

Update the `uuid` used later in the transaction (currently `const uuid = randomUUID();` around line 251) to prefer the client-supplied one:

```ts
      const uuid = preAssigned?.uuid ?? randomUUID();
```

Finally, update the handler's return statement (after the `try`/`catch`, around line 322) to unwrap the new shape and pick the right status code:

```ts
    const { existing: document, isRetry } = result;
    return NextResponse.json(document, { status: isRetry ? 200 : 201 });
```

(rename the `const document = await prisma.$transaction(...)` result variable to `result` to match).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/receipts/route.test.ts`
Expected: PASS — all tests including the 3 new ones and every pre-existing one (confirms the `preAssigned`-absent path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/receipts/route.ts src/app/api/receipts/route.test.ts
git commit -m "Accept a pre-assigned invoice number and uuid for offline receipt sync"
```

---

### Task 5: `/api/quotations` accepts a pre-assigned number from an owned lease

Mirrors Task 4 exactly, for `QUOTATION` instead of `SALES_RECEIPT`, with two simplifications: quotations have no hash chain (skip the `previousInvoiceHash`/`invoiceHash` handling entirely), and `Document.uuid` has no explicit assignment in the current route (it relies on Prisma's `@default(uuid())`) — this task adds the same `preAssigned?.uuid ?? undefined` pass-through so Prisma still auto-generates one when absent.

**Files:**
- Modify: `src/app/api/quotations/route.ts`
- Modify: `src/app/api/quotations/route.test.ts`

**Interfaces:**
- Consumes: `NumberLease` (Task 1).
- Produces: same `preAssigned`/`X-Device-Id` request shape as Task 4, for `documentType: "QUOTATION"`.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/api/quotations/route.test.ts`, the same 3 tests as Task 4 Step 1, with these substitutions: `"http://localhost/api/quotations"`, `documentType: "QUOTATION"`, `data: { nextQuotationNumber: { increment: 20 } }` / `select: { nextQuotationNumber: true }` in the fixture setup, and device ids `"device-lease-test-q"` / `"device-with-no-lease-q"` / `"device-retry-test-q"` (distinct from Task 4's, since both test files may run against the same shared dev database).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/quotations/route.test.ts`
Expected: FAIL — same shape of failures as Task 4 Step 2.

- [ ] **Step 3: Modify the route**

In `src/app/api/quotations/route.ts`, apply the same four edits as Task 4 Step 3, adapted:
- After `const body = await request.json();`: add the same `deviceId`/`preAssigned` extraction.
- After `const settings = await txn.settings.findUniqueOrThrow(...)`: add the same idempotency short-circuit, changing `documentType` lookups to `"QUOTATION"` and the final transaction return to `{ existing: created, isRetry: false } as const` (update the existing final `return created;` the same way).
- Replace the number-assignment block (the `tenantCounters`/`number` block using `nextQuotationNumber`, around lines 130-135) with:

```ts
      let number: number;
      if (preAssigned) {
        if (!deviceId) {
          throw new QuotationError("X-Device-Id header is required with a pre-assigned number", 400);
        }
        const lease = await txn.numberLease.findFirst({
          where: {
            tenantId,
            deviceId,
            documentType: "QUOTATION",
            rangeStart: { lte: preAssigned.number },
            rangeEnd: { gte: preAssigned.number },
          },
        });
        if (!lease) {
          throw new QuotationError("This number was not leased to your device", 409);
        }
        const alreadyUsed = await txn.document.findFirst({ where: { tenantId, type: "QUOTATION", number: preAssigned.number } });
        if (alreadyUsed) {
          throw new QuotationError("This number has already been used", 409);
        }
        number = preAssigned.number;
      } else {
        const tenantCounters = await txn.tenant.update({
          where: { id: tenantId },
          data: { nextQuotationNumber: { increment: 1 } },
          select: { nextQuotationNumber: true },
        });
        number = tenantCounters.nextQuotationNumber - 1;
      }
```

- In the `txn.document.create({ data: { ... } })` call, add `uuid: preAssigned?.uuid` as an explicit field (Prisma's `@default(uuid())` only applies when the field is omitted entirely from `data`, so passing `undefined` when there's no `preAssigned` keeps today's auto-generation behavior).
- Update the handler's final return the same way as Task 4 Step 3's last edit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/quotations/route.test.ts`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/quotations/route.ts src/app/api/quotations/route.test.ts
git commit -m "Accept a pre-assigned quotation number and uuid for offline sync"
```

---

### Task 6: `/api/offline-data` + `/api/health`

**Files:**
- Create: `src/app/api/offline-data/route.ts`
- Create: `src/app/api/offline-data/route.test.ts`
- Create: `src/app/api/health/route.ts`

**Interfaces:**
- Produces: `GET /api/offline-data` → `{ products: SerializedProduct[], customers: Customer[], settings: { defaultVatRate: string, printFormat: "THERMAL"|"A4" }, tenant: { tradeNameEn, tradeNameAr, legalName, vatNumber, crNumber, phone, address } }` — consumed by Task 9's cache-sync.
- Produces: `GET /api/health` → `{ ok: true }`, 200 status only when reachable — used by Task 11's connectivity hook as a real liveness probe.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/offline-data/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET } from "./route";

let tenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("/api/offline-data", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Offline Data Co", tradeNameEn: "Offline Data Shop", vatNumber: "300000000000321" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
    await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Offline Product", sku: "SKU-OFF-1", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput })
    );
  }, 30000);

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns products, customers, settings, and tenant info", { timeout: 30000 }, async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.products).toHaveLength(1);
    expect(body.products[0].sku).toBe("SKU-OFF-1");
    expect(typeof body.products[0].unitPrice).toBe("string");
    expect(body.settings.printFormat).toBe("THERMAL");
    expect(body.tenant.tradeNameEn).toBe("Offline Data Shop");
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await GET();
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/offline-data/route.test.ts`
Expected: FAIL with "Cannot find module './route'".

- [ ] **Step 3: Implement the route**

Create `src/app/api/offline-data/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

// Everything /receipts/new and /quotations/new need to render and let a
// cashier build a sale, bundled for the client-side offline cache
// (src/lib/offline/cache-sync.ts). Deliberately shared by both document
// types -- the underlying data (catalog, customers, settings, tenant info)
// is identical regardless of what's being created from it.
export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const [customers, products, settings, tenant] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      tx.product.findMany({ where: { isActive: true }, orderBy: { nameEn: "asc" } }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { tradeNameEn: true, tradeNameAr: true, legalName: true, vatNumber: true, crNumber: true, phone: true, address: true },
      }),
    ])
  );

  const serializedProducts = products.map((p) => ({
    ...p,
    unitPrice: p.unitPrice.toString(),
    vatRate: p.vatRate?.toString() ?? null,
    quantity: p.quantity.toString(),
    lowStockThreshold: p.lowStockThreshold?.toString() ?? null,
  }));

  return NextResponse.json({
    products: serializedProducts,
    customers,
    settings: { defaultVatRate: settings.defaultVatRate.toString(), printFormat: settings.printFormat },
    tenant,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/api/offline-data/route.test.ts`
Expected: PASS — both tests.

- [ ] **Step 5: Add the health route (no test needed — trivial, stateless)**

Create `src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

// Used only for real connectivity detection (src/lib/offline/connectivity.ts)
// -- navigator.onLine alone can't distinguish "Wi-Fi connected, server
// unreachable" from genuinely online. No auth, no DB call: the point is to
// be as cheap and fast as possible to ping frequently.
export async function GET() {
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/offline-data src/app/api/health
git commit -m "Add offline-data and health endpoints for the offline cache"
```

---

### Task 7: Offline storage foundation — Dexie schema + device id

**Files:**
- Modify: `package.json` (add `dexie` dependency)
- Create: `src/lib/offline/db.ts`
- Create: `src/lib/offline/device-id.ts`

**Interfaces:**
- Produces: `offlineDb` (a Dexie instance) with tables `products`, `customers`, `settings`, `tenant`, `numberLeases`, `pendingReceipts`, `pendingQuotations` — consumed by Tasks 8, 9, 10, 13.
- Produces: `getDeviceId(): string` — consumed by Tasks 8, 10, 13.

- [ ] **Step 1: Install Dexie**

Run: `npm install dexie`
Expected: `package.json`'s `dependencies` gains `"dexie": "^4.x.x"`.

- [ ] **Step 2: Define the Dexie schema**

Create `src/lib/offline/db.ts`:

```ts
import Dexie, { type Table } from "dexie";

export interface CachedProduct {
  id: string;
  nameEn: string;
  nameAr: string | null;
  sku: string;
  barcode: string | null;
  unitPrice: string;
  vatRate: string | null;
  quantity: string;
  unit: string;
  isActive: boolean;
}

export interface CachedCustomer {
  id: string;
  name: string;
  vatId: string | null;
  crNumber: string | null;
  phone: string | null;
  address: string | null;
  isWalkIn: boolean;
  isActive: boolean;
}

export interface CachedSettings {
  id: "singleton";
  defaultVatRate: string;
  printFormat: "THERMAL" | "A4";
}

export interface CachedTenant {
  id: "singleton";
  tradeNameEn: string;
  tradeNameAr: string | null;
  legalName: string;
  vatNumber: string;
  crNumber: string | null;
  phone: string | null;
  address: string | null;
}

export interface StoredNumberLease {
  id?: number; // Dexie auto-increment primary key
  documentType: "SALES_RECEIPT" | "QUOTATION";
  rangeStart: number;
  rangeEnd: number;
  nextToIssue: number;
}

export interface PendingLine {
  productId: string;
  quantity: number;
  discount: number;
  unitPrice: number;
}

export interface PendingDocument {
  uuid: string; // primary key -- also the idempotency key sent to the server
  number: number;
  customer: { name: string; vatId: string; crNumber: string; phone: string; address: string };
  lines: PendingLine[];
  notes: string;
  createdAt: string; // ISO 8601, set at local creation time for offline printing
  status: "pending" | "syncing" | "failed";
}

class OfflineDatabase extends Dexie {
  products!: Table<CachedProduct, string>;
  customers!: Table<CachedCustomer, string>;
  settings!: Table<CachedSettings, string>;
  tenant!: Table<CachedTenant, string>;
  numberLeases!: Table<StoredNumberLease, number>;
  pendingReceipts!: Table<PendingDocument, string>;
  pendingQuotations!: Table<PendingDocument, string>;

  constructor() {
    super("fatoorasync-offline");
    this.version(1).stores({
      products: "id, sku, barcode",
      customers: "id, vatId",
      settings: "id",
      tenant: "id",
      numberLeases: "++id, documentType",
      pendingReceipts: "uuid, status",
      pendingQuotations: "uuid, status",
    });
  }
}

export const offlineDb = new OfflineDatabase();
```

- [ ] **Step 3: Add the device id helper**

Create `src/lib/offline/device-id.ts`:

```ts
const STORAGE_KEY = "fatoorasync-device-id";

// One stable UUID per browser/installed-PWA instance, generated once and
// reused forever after -- this is what a NumberLease is reserved against
// (src/lib/receipts/lease-block.ts) and what the server validates a
// pre-assigned number's ownership against (src/app/api/receipts/route.ts).
export function getDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, generated);
  return generated;
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0, no type errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/offline/db.ts src/lib/offline/device-id.ts
git commit -m "Add Dexie-backed offline storage foundation"
```

---

### Task 8: Client-side lease store

**Files:**
- Create: `src/lib/offline/lease-store.ts`
- Create: `src/lib/offline/lease-store.test.ts`

**Interfaces:**
- Consumes: `offlineDb` (Task 7), `getDeviceId` (Task 7).
- Produces: `issueNumber(documentType: "SALES_RECEIPT" | "QUOTATION"): Promise<number | null>` (returns the next number and advances `nextToIssue`, or `null` if no lease has any capacity left), `remainingCapacity(documentType): Promise<number>`, `storeLeasedBlock(documentType, rangeStart, rangeEnd): Promise<void>` — consumed by Task 13's save flow.

This test file needs a real IndexedDB implementation in the Vitest (Node) environment. Check `vitest.config.ts` first — if it doesn't already configure `fake-indexeddb`, add it.

- [ ] **Step 1: Check the Vitest environment and add `fake-indexeddb` if needed**

Run: `cat vitest.config.ts` (or open it) and check for an existing `environment`/`setupFiles` entry covering IndexedDB.

If absent, run: `npm install -D fake-indexeddb`, and add a setup file. Create `src/lib/offline/test-setup.ts`:

```ts
import "fake-indexeddb/auto";
```

Add to `vitest.config.ts`'s `test` config: `setupFiles: ["./src/lib/offline/test-setup.ts"]` (merge with any existing `setupFiles` array rather than overwriting it).

- [ ] **Step 2: Write the failing tests**

Create `src/lib/offline/lease-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { offlineDb } from "./db";
import { storeLeasedBlock, issueNumber, remainingCapacity } from "./lease-store";

describe("lease-store", () => {
  beforeEach(async () => {
    await offlineDb.numberLeases.clear();
  });

  it("issues numbers sequentially from a stored block", async () => {
    await storeLeasedBlock("SALES_RECEIPT", 5, 24);
    expect(await issueNumber("SALES_RECEIPT")).toBe(5);
    expect(await issueNumber("SALES_RECEIPT")).toBe(6);
    expect(await issueNumber("SALES_RECEIPT")).toBe(7);
  });

  it("returns null once every leased block is exhausted", async () => {
    await storeLeasedBlock("SALES_RECEIPT", 1, 1);
    expect(await issueNumber("SALES_RECEIPT")).toBe(1);
    expect(await issueNumber("SALES_RECEIPT")).toBeNull();
  });

  it("keeps SALES_RECEIPT and QUOTATION capacity independent", async () => {
    await storeLeasedBlock("SALES_RECEIPT", 1, 1);
    expect(await issueNumber("QUOTATION")).toBeNull();
    expect(await remainingCapacity("SALES_RECEIPT")).toBe(0); // consumed by nothing yet, but block size 1 -- see next line
  });

  it("reports remaining capacity across multiple leased blocks", async () => {
    await storeLeasedBlock("SALES_RECEIPT", 1, 5);
    await storeLeasedBlock("SALES_RECEIPT", 6, 10);
    expect(await remainingCapacity("SALES_RECEIPT")).toBe(10);
    await issueNumber("SALES_RECEIPT");
    expect(await remainingCapacity("SALES_RECEIPT")).toBe(9);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/offline/lease-store.test.ts`
Expected: FAIL with "Cannot find module './lease-store'".

- [ ] **Step 4: Implement the lease store**

Create `src/lib/offline/lease-store.ts`:

```ts
import { offlineDb, type StoredNumberLease } from "./db";

type DocumentType = "SALES_RECEIPT" | "QUOTATION";

export async function storeLeasedBlock(documentType: DocumentType, rangeStart: number, rangeEnd: number): Promise<void> {
  await offlineDb.numberLeases.add({ documentType, rangeStart, rangeEnd, nextToIssue: rangeStart });
}

// Draws the next number from the oldest leased block that still has capacity,
// advancing that block's nextToIssue by one. Returns null when every stored
// block for this document type is exhausted -- the caller (the save flow,
// Task 13) is responsible for queueing without a final number in that rare
// case, per spec §4.1.
export async function issueNumber(documentType: DocumentType): Promise<number | null> {
  return offlineDb.transaction("rw", offlineDb.numberLeases, async () => {
    const blocks = await offlineDb.numberLeases.where("documentType").equals(documentType).sortBy("rangeStart");
    const block = blocks.find((b) => b.nextToIssue <= b.rangeEnd);
    if (!block) return null;
    const issued = block.nextToIssue;
    await offlineDb.numberLeases.update(block.id as number, { nextToIssue: issued + 1 });
    return issued;
  });
}

export async function remainingCapacity(documentType: DocumentType): Promise<number> {
  const blocks = await offlineDb.numberLeases.where("documentType").equals(documentType).toArray();
  return blocks.reduce((sum: number, b: StoredNumberLease) => sum + Math.max(0, b.rangeEnd - b.nextToIssue + 1), 0);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/offline/lease-store.test.ts`
Expected: PASS — all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/offline/test-setup.ts src/lib/offline/lease-store.ts src/lib/offline/lease-store.test.ts
git commit -m "Add client-side number-lease consumption logic"
```

---

### Task 9: Cache-sync — mirror `/api/offline-data` into Dexie, and refill leases

**Files:**
- Create: `src/lib/offline/cache-sync.ts`

**Interfaces:**
- Consumes: `GET /api/offline-data` (Task 6), `offlineDb` (Task 7), `getDeviceId` (Task 7), `remainingCapacity`/`storeLeasedBlock` (Task 8).
- Produces: `syncOfflineCache(): Promise<void>` — called from Task 13's page components on every successful online load.

- [ ] **Step 1: Implement**

Create `src/lib/offline/cache-sync.ts`:

```ts
import { offlineDb } from "./db";
import { getDeviceId } from "./device-id";
import { remainingCapacity, storeLeasedBlock } from "./lease-store";

const REFILL_THRESHOLD = 5;

// Called whenever /receipts/new or /quotations/new load successfully online
// (Task 13). Mirrors the current catalog/customers/settings/tenant into
// Dexie, and tops up this device's number leases if they're running low --
// both as ordinary side effects of normal page usage, not a separate
// background job.
export async function syncOfflineCache(): Promise<void> {
  const response = await fetch("/api/offline-data");
  if (!response.ok) return;
  const data = await response.json();

  await offlineDb.transaction("rw", [offlineDb.products, offlineDb.customers, offlineDb.settings, offlineDb.tenant], async () => {
    await offlineDb.products.clear();
    await offlineDb.products.bulkAdd(data.products);
    await offlineDb.customers.clear();
    await offlineDb.customers.bulkAdd(data.customers);
    await offlineDb.settings.put({ id: "singleton", ...data.settings });
    await offlineDb.tenant.put({ id: "singleton", ...data.tenant });
  });

  await refillLeaseIfLow("SALES_RECEIPT", "/api/receipts/lease-numbers");
  await refillLeaseIfLow("QUOTATION", "/api/quotations/lease-numbers");
}

async function refillLeaseIfLow(documentType: "SALES_RECEIPT" | "QUOTATION", endpoint: string): Promise<void> {
  const remaining = await remainingCapacity(documentType);
  if (remaining >= REFILL_THRESHOLD) return;
  const response = await fetch(endpoint, { method: "POST", headers: { "X-Device-Id": getDeviceId() } });
  if (!response.ok) return;
  const { rangeStart, rangeEnd } = await response.json();
  await storeLeasedBlock(documentType, rangeStart, rangeEnd);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/offline/cache-sync.ts
git commit -m "Add offline cache-sync that mirrors catalog data and tops up leases"
```

(No dedicated unit test here — this function is a thin orchestration wrapper over already-tested pieces (Task 8) and a `fetch` call; it's exercised end-to-end by Task 16's manual verification. Adding a mocked-fetch test would mostly test the mock, not real behavior.)

---

### Task 10: Outbox — enqueue, dedup, and replay pending sales

**Files:**
- Create: `src/lib/offline/outbox.ts`
- Create: `src/lib/offline/outbox.test.ts`

**Interfaces:**
- Consumes: `offlineDb`, `PendingDocument` (Task 7), `getDeviceId` (Task 7).
- Produces: `enqueuePending(kind: "receipt" | "quotation", doc: PendingDocument): Promise<void>`, `replayPending(kind: "receipt" | "quotation"): Promise<{ synced: number; stillPending: number }>`, `pendingCount(kind): Promise<number>` — consumed by Task 13 (enqueue on save) and Task 11/14 (replay trigger + status display).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/offline/outbox.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { offlineDb, type PendingDocument } from "./db";
import { enqueuePending, replayPending, pendingCount } from "./outbox";

const sampleDoc: PendingDocument = {
  uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  number: 8,
  customer: { name: "", vatId: "", crNumber: "", phone: "", address: "" },
  lines: [{ productId: "prod-1", quantity: 2, discount: 0, unitPrice: 10 }],
  notes: "",
  createdAt: "2026-08-27T10:00:00.000Z",
  status: "pending",
};

describe("outbox", () => {
  beforeEach(async () => {
    await offlineDb.pendingReceipts.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues a pending receipt and reports it in the count", async () => {
    await enqueuePending("receipt", sampleDoc);
    expect(await pendingCount("receipt")).toBe(1);
  });

  it("replays a pending receipt against the real endpoint and removes it on success", async () => {
    await enqueuePending("receipt", sampleDoc);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "doc-1", number: 8 }) });

    const result = await replayPending("receipt");

    expect(result).toEqual({ synced: 1, stillPending: 0, authExpired: false });
    expect(await pendingCount("receipt")).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/receipts",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("leaves a pending receipt queued when the replay request fails", async () => {
    await enqueuePending("receipt", sampleDoc);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const result = await replayPending("receipt");

    expect(result).toEqual({ synced: 0, stillPending: 1, authExpired: false });
    expect(await pendingCount("receipt")).toBe(1);
  });

  it("does not double-count an item that fails, then succeeds on a later replay", async () => {
    await enqueuePending("receipt", sampleDoc);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await replayPending("receipt");

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "doc-1", number: 8 }) });
    const result = await replayPending("receipt");

    expect(result).toEqual({ synced: 1, stillPending: 0, authExpired: false });
  });

  it("flags authExpired on a 401 instead of a generic pending state", async () => {
    await enqueuePending("receipt", sampleDoc);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const result = await replayPending("receipt");

    expect(result).toEqual({ synced: 0, stillPending: 1, authExpired: true });
    expect(await pendingCount("receipt")).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/offline/outbox.test.ts`
Expected: FAIL with "Cannot find module './outbox'".

- [ ] **Step 3: Implement the outbox**

Create `src/lib/offline/outbox.ts`:

```ts
import { offlineDb, type PendingDocument } from "./db";
import { getDeviceId } from "./device-id";

type Kind = "receipt" | "quotation";

function tableFor(kind: Kind) {
  return kind === "receipt" ? offlineDb.pendingReceipts : offlineDb.pendingQuotations;
}

function endpointFor(kind: Kind): string {
  return kind === "receipt" ? "/api/receipts" : "/api/quotations";
}

export async function enqueuePending(kind: Kind, doc: PendingDocument): Promise<void> {
  await tableFor(kind).add(doc);
}

export async function pendingCount(kind: Kind): Promise<number> {
  return tableFor(kind).count();
}

// Replays every queued item against the real save endpoint, in the order it
// was created (Dexie's primary-key insertion order). Each item's `uuid` is
// sent as the request's idempotency key -- the server (Task 4/5) treats a
// resubmission of an already-saved uuid as a no-op, so a request that
// actually succeeded but whose response was lost to a flaky connection can't
// create a duplicate receipt on the next replay.
//
// `authExpired` surfaces the one failure mode that isn't "still offline":
// a 401 means connectivity is fine but the cached session expired while this
// device was away, so no further retry will succeed until the cashier logs
// in again. Task 14's status indicator uses this to show that specific
// message instead of a generic "still syncing" one (spec §7).
export async function replayPending(kind: Kind): Promise<{ synced: number; stillPending: number; authExpired: boolean }> {
  const table = tableFor(kind);
  const items = await table.orderBy("uuid").toArray();
  let synced = 0;
  let stillPending = 0;
  let authExpired = false;

  for (const doc of items) {
    try {
      const response = await fetch(endpointFor(kind), {
        method: "POST",
        headers: { "X-Device-Id": getDeviceId() },
        body: JSON.stringify({
          customer: doc.customer,
          lines: doc.lines,
          notes: doc.notes,
          preAssigned: { number: doc.number, uuid: doc.uuid },
        }),
      });
      if (response.ok) {
        await table.delete(doc.uuid);
        synced++;
      } else {
        stillPending++;
        if (response.status === 401) authExpired = true;
      }
    } catch {
      stillPending++;
    }
  }

  return { synced, stillPending, authExpired };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/offline/outbox.test.ts`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/outbox.ts src/lib/offline/outbox.test.ts
git commit -m "Add offline outbox with idempotent replay"
```

---

### Task 11: Connectivity hook

**Files:**
- Create: `src/lib/offline/connectivity.ts`

**Interfaces:**
- Produces: `useOnlineStatus(): boolean` (a React hook), and `subscribeOnlineStatus(callback: (online: boolean) => void): () => void` (the underlying subscription, for Task 14's non-React usage if needed) — consumed by Task 13 (gates the save path) and Task 14 (status indicator).

- [ ] **Step 1: Implement**

Create `src/lib/offline/connectivity.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

const HEALTH_CHECK_INTERVAL_MS = 15000;

// navigator.onLine alone is unreliable -- it can report "online" when Wi-Fi
// is connected but the app's own server is unreachable. This pairs it with a
// real periodic ping to /api/health (a trivial, unauthenticated, no-DB
// endpoint -- see src/app/api/health/route.ts) so the offline outbox and
// status indicator react to the connectivity that actually matters.
async function pingHealth(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export function subscribeOnlineStatus(callback: (online: boolean) => void): () => void {
  let cancelled = false;

  async function check() {
    const reachable = navigator.onLine && (await pingHealth());
    if (!cancelled) callback(reachable);
  }

  check();
  const interval = setInterval(check, HEALTH_CHECK_INTERVAL_MS);
  window.addEventListener("online", check);
  window.addEventListener("offline", check);

  return () => {
    cancelled = true;
    clearInterval(interval);
    window.removeEventListener("online", check);
    window.removeEventListener("offline", check);
  };
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => subscribeOnlineStatus(setOnline), []);

  return online;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/offline/connectivity.ts
git commit -m "Add real connectivity detection combining navigator.onLine and a health ping"
```

(No unit test — this is a thin DOM-event/timer wrapper; its correctness is verified live in Task 16's browser walkthrough, same reasoning as Task 9.)

---

### Task 12: `PrintModal` accepts offline-rendered data directly

**Files:**
- Modify: `src/components/documents/print-modal.tsx`
- Create: `src/lib/offline/print-data.ts`

**Interfaces:**
- Produces: `buildOfflinePrintData(kind: "receipt" | "quotation", doc: PendingDocument, resolvedLines: {...}[]): Promise<PrintData>` (builds the same shape `/api/{kind}s/{id}/print-data` returns today, using cached tenant/settings + a client-generated QR image) — consumed by Task 13.
- Modifies: `PrintModal`'s props gain an optional `initialData?: PrintData | null`. When provided, the fetch-by-id effect is skipped entirely and the Download-PDF button (which requires a real server id) is hidden.

- [ ] **Step 1: Build the offline print-data helper**

Create `src/lib/offline/print-data.ts`:

```ts
import QRCode from "qrcode";
import { offlineDb, type PendingDocument } from "./db";
import { buildZatcaQrPayload } from "@/lib/zatca/qr-payload";
import { calculateDocumentTotals, type LineTotals } from "@/lib/receipts/calculate-totals";

// The exact fields calculateDocumentTotals() needs (LineTotals), plus what
// the print templates display. Callers (Task 13) build this with the same
// calculateLine() call the online route uses, so offline and online receipts
// total identically for the same inputs.
export interface OfflineResolvedLine extends LineTotals {
  id: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  discount: string;
}

// Mirrors the shape src/app/api/receipts/[id]/print-data/route.ts returns for
// a synced receipt, built entirely from local Dexie data -- this is what lets
// PrintModal (see below) render an offline sale identically to an online one,
// with no server round trip. Quotations skip the QR entirely, matching the
// existing online quotation print path (quotations are never invoiced, so
// they never carried a QR to begin with).
export async function buildOfflinePrintData(kind: "receipt" | "quotation", doc: PendingDocument, resolvedLines: OfflineResolvedLine[]) {
  const [settings, tenant] = await Promise.all([
    offlineDb.settings.get("singleton"),
    offlineDb.tenant.get("singleton"),
  ]);
  if (!settings || !tenant) throw new Error("Offline cache is empty -- open this page online at least once first");

  const { subtotal, vatTotal, grandTotal } = calculateDocumentTotals(resolvedLines);

  let qrImageDataUrl: string | null = null;
  if (kind === "receipt") {
    const qrPayload = buildZatcaQrPayload({
      sellerName: tenant.legalName,
      vatNumber: tenant.vatNumber,
      timestamp: doc.createdAt,
      invoiceTotal: grandTotal.toFixed(2),
      vatTotal: vatTotal.toFixed(2),
    });
    qrImageDataUrl = await QRCode.toDataURL(qrPayload);
  }

  return {
    printFormat: settings.printFormat,
    tenant: {
      tradeNameEn: tenant.tradeNameEn,
      tradeNameAr: tenant.tradeNameAr,
      legalName: tenant.legalName,
      vatNumber: tenant.vatNumber,
      crNumber: tenant.crNumber,
      phone: tenant.phone,
      address: tenant.address,
    },
    document: {
      number: doc.number,
      createdAt: doc.createdAt,
      subtotal: subtotal.toFixed(2),
      vatTotal: vatTotal.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      notes: doc.notes || null,
      customer: {
        name: doc.customer.name || "Walk-in Customer",
        vatId: doc.customer.vatId || null,
        crNumber: doc.customer.crNumber || null,
        phone: doc.customer.phone || null,
        address: doc.customer.address || null,
      },
      lines: resolvedLines.map(({ id, productName, quantity, unitPrice, discount, lineVat, lineTotal }) => ({
        id, productName, quantity, unitPrice, discount,
        lineVat: lineVat.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
      })),
    },
    qrImageDataUrl,
  };
}
```

- [ ] **Step 2: Modify `PrintModal`**

In `src/components/documents/print-modal.tsx`:

Rename the existing `data`/`setData` state to `fetchedData`/`setFetchedData`, and add the new prop. Change the props type (around line 50-58) to:

```ts
export function PrintModal({
  kind,
  documentId,
  initialData,
  onOpenChange,
}: {
  kind: "receipt" | "quotation";
  documentId: string | null;
  initialData?: PrintData | null;
  onOpenChange: (open: boolean) => void;
}) {
```

Guard the existing fetch effect (around line 65) so it's skipped when `initialData` is supplied:

```ts
  useEffect(() => {
    if (initialData) return;
    if (!documentId) {
      setFetchedData(null);
      return;
    }
    // ...rest of the existing effect body, unchanged except setData -> setFetchedData
```

Add, right after the effect, a computed effective value and open-state:

```ts
  const data = initialData ?? fetchedData;
  const open = initialData ? true : documentId !== null;
```

(remove the old `const open = documentId !== null;` line it replaces).

Finally, hide the Download button when there's no real server id to download from (around line 140-143):

```tsx
              {!initialData && (
                <Button variant="outline" asChild>
                  <a href={`/api/${kind}s/${documentId}/pdf`}>{dict.common.download}</a>
                </Button>
              )}
```

- [ ] **Step 3: Verify it compiles and existing print-modal usages still work**

Run: `npx tsc --noEmit`
Expected: exits 0.

Run: `npx vitest run src/app/api/receipts/[id]/print-data`
Expected: PASS (no test files match — this route has no dedicated test today; this step just confirms the command finds nothing broken to report. If a matching test file does exist, expect PASS.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/offline/print-data.ts src/components/documents/print-modal.tsx
git commit -m "Let PrintModal render from local data for offline-created sales"
```

---

### Task 13: Offline-aware save + client-fetched pages

This is the integration task that wires Tasks 6-12 into the actual cashier-facing flow.

**Files:**
- Modify: `src/app/(app)/receipts/new/page.tsx`
- Modify: `src/app/(app)/quotations/new/page.tsx`
- Modify: `src/components/receipts/receipt-form.tsx`
- Modify: `src/components/quotations/quotation-form.tsx` (mirrors the receipt-form changes)

**Interfaces:**
- Consumes: `syncOfflineCache` (Task 9), `enqueuePending`/`replayPending` (Task 10), `issueNumber` (Task 8), `useOnlineStatus` (Task 11), `buildOfflinePrintData` (Task 12), `offlineDb` (Task 7).

- [ ] **Step 1: Convert `/receipts/new` to a client-fetched page**

Replace the full contents of `src/app/(app)/receipts/new/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@prisma/client";
import { offlineDb } from "@/lib/offline/db";
import { syncOfflineCache } from "@/lib/offline/cache-sync";
import { useOnlineStatus } from "@/lib/offline/connectivity";
import { ReceiptForm } from "@/components/receipts/receipt-form";
import type { SerializedProduct } from "@/components/products/products-client";
import { Loader2Icon } from "lucide-react";

export default function NewReceiptPage() {
  const online = useOnlineStatus();
  const [data, setData] = useState<{ customers: Customer[]; products: SerializedProduct[]; defaultVatRate: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (online) {
        try {
          await syncOfflineCache();
        } catch {
          // Fall through to the Dexie read below -- a failed cache refresh
          // (e.g. connectivity dropped mid-request) shouldn't block the page
          // from rendering whatever was already cached from a prior visit.
        }
      }
      const [products, customers, settings] = await Promise.all([
        offlineDb.products.toArray(),
        offlineDb.customers.toArray(),
        offlineDb.settings.get("singleton"),
      ]);
      if (!cancelled) {
        setData({
          products: products as unknown as SerializedProduct[],
          customers: customers as unknown as Customer[],
          defaultVatRate: settings?.defaultVatRate ?? "15",
        });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [online]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="size-6 animate-spin text-muted-fg" />
      </div>
    );
  }

  return <ReceiptForm initialCustomers={data.customers} initialProducts={data.products} defaultVatRate={data.defaultVatRate} />;
}
```

- [ ] **Step 2: Repeat Step 1 for `/quotations/new`**

Replace the full contents of `src/app/(app)/quotations/new/page.tsx` identically, substituting `QuotationForm` for `ReceiptForm` and its import path.

- [ ] **Step 3: Add offline-aware saving to `ReceiptForm`**

In `src/components/receipts/receipt-form.tsx`, add these imports near the top:

```ts
import { issueNumber } from "@/lib/offline/lease-store";
import { enqueuePending } from "@/lib/offline/outbox";
import { buildOfflinePrintData, type OfflineResolvedLine } from "@/lib/offline/print-data";
import { useOnlineStatus } from "@/lib/offline/connectivity";
```

Add, inside the component body (near the other `useState` calls around line 48-59):

```ts
  const online = useOnlineStatus();
  const [offlinePrintData, setOfflinePrintData] = useState<Awaited<ReturnType<typeof buildOfflinePrintData>> | null>(null);
```

Replace the full body of `handleSave` (lines 220-284) with this version, which tries the network first and falls back to the offline outbox on failure — the fallback builds `resolvedLines` with the same `calculateLine()` the online route itself uses (imported already at the top of this file, per line 11), so offline and online totals never diverge for the same inputs:

```ts
  interface ReceiptPayload {
    customer: CustomerDraft;
    lines: { productId: string; quantity: string; discount: string; unitPrice: string }[];
    notes: string;
  }

  async function handleSave(printAfter: boolean) {
    if (lines.length === 0) {
      setError(dict.documentForm.totals.addAtLeastOneItem);
      return;
    }
    setSaving(true);
    setError(null);

    const payload: ReceiptPayload = {
      customer: customerDraft,
      lines: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discount: line.discount,
        unitPrice: line.unitPrice,
      })),
      notes,
    };

    if (online) {
      try {
        const response = await fetch("/api/receipts", { method: "POST", body: JSON.stringify(payload) });
        const body = await response.json();
        if (!response.ok) {
          setError(body.error ?? dict.common.somethingWentWrong);
          setSaving(false);
          return;
        }
        const trimmedName = customerDraft.name.trim();
        const trimmedVatId = customerDraft.vatId.trim();
        if (trimmedName && trimmedVatId) {
          setCustomers((prev) =>
            prev.some((c) => c.vatId === trimmedVatId)
              ? prev
              : [
                  ...prev,
                  {
                    id: body.customerId,
                    tenantId: "",
                    name: trimmedName,
                    vatId: trimmedVatId,
                    crNumber: customerDraft.crNumber.trim() || null,
                    phone: customerDraft.phone.trim() || null,
                    address: customerDraft.address.trim() || null,
                    isWalkIn: false,
                    isActive: true,
                    createdAt: new Date(),
                  },
                ]
          );
        }
        if (printAfter) {
          setPrintModalId(body.id);
          setSaving(false);
        } else {
          toast.success(dict.documentForm.totals.savedToast);
          resetForm();
          setSaving(false);
        }
        return;
      } catch {
        // Actual network failure despite useOnlineStatus() reporting online --
        // fall through to the offline path below, same as being offline from
        // the start.
      }
    }

    const number = await issueNumber("SALES_RECEIPT");
    if (number === null) {
      setError(dict.documentForm.totals.offlineNumbersExhausted);
      setSaving(false);
      return;
    }

    const uuid = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const resolvedLines: OfflineResolvedLine[] = payload.lines.map((line) => {
      const product = products.find((p) => p.id === line.productId);
      const unitPrice = Number(line.unitPrice);
      const quantity = Number(line.quantity);
      const discount = Number(line.discount || 0);
      const vatRate = product?.vatRate ? Number(product.vatRate) : Number(defaultVatRate);
      const { lineSubtotal, lineVat, lineTotal } = calculateLine({ unitPrice, quantity, vatRate, discount });
      return {
        id: line.productId,
        productName: product?.nameEn ?? "",
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        lineSubtotal,
        lineVat,
        lineTotal,
      };
    });

    await enqueuePending("receipt", {
      uuid,
      number,
      customer: {
        name: payload.customer.name,
        vatId: payload.customer.vatId,
        crNumber: payload.customer.crNumber,
        phone: payload.customer.phone,
        address: payload.customer.address,
      },
      lines: payload.lines.map((line) => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        discount: Number(line.discount || 0),
        unitPrice: Number(line.unitPrice),
      })),
      notes: payload.notes,
      createdAt,
      status: "pending",
    });

    const printData = await buildOfflinePrintData(
      "receipt",
      { uuid, number, customer: payload.customer as never, lines: [], notes: payload.notes, createdAt, status: "pending" },
      resolvedLines
    );

    toast.success(dict.documentForm.totals.savedOfflineToast);
    if (printAfter) {
      setOfflinePrintData(printData);
    } else {
      resetForm();
    }
    setSaving(false);
  }
```

- [ ] **Step 4: Wire `offlinePrintData` into the existing `PrintModal` usage**

Find where `<PrintModal ... documentId={printModalId} .../>` is rendered (near the bottom of the component). Change it to also pass the offline data, and to open when either is set:

```tsx
      <PrintModal
        kind="receipt"
        documentId={printModalId}
        initialData={offlinePrintData}
        onOpenChange={(open) => {
          if (!open) {
            setPrintModalId(null);
            setOfflinePrintData(null);
            resetForm();
          }
        }}
      />
```

- [ ] **Step 5: Add the two new dictionary strings**

In `src/lib/i18n/dictionaries/dictionary.types.ts`, add to the `documentForm.totals` interface:

```ts
    offlineNumbersExhausted: string;
    savedOfflineToast: string;
```

In `src/lib/i18n/dictionaries/en.ts`, under `documentForm.totals`:

```ts
    offlineNumbersExhausted: "You're offline and out of reserved numbers — reconnect briefly to keep selling.",
    savedOfflineToast: "Saved offline — will sync automatically once you're back online.",
```

In `src/lib/i18n/dictionaries/ar.ts`, under `documentForm.totals`:

```ts
    offlineNumbersExhausted: "أنت غير متصل ونفدت الأرقام المحجوزة — يرجى إعادة الاتصال للاستمرار في البيع.",
    savedOfflineToast: "تم الحفظ دون اتصال — ستتم المزامنة تلقائيًا عند عودة الاتصال.",
```

- [ ] **Step 6: Repeat Steps 3-5 for `QuotationForm`**

Apply the same changes to `src/components/quotations/quotation-form.tsx`, substituting: `/api/quotations` for the endpoint, `"QUOTATION"` for `issueNumber`/`buildOfflinePrintData`'s document type argument, `enqueuePending("quotation", ...)`, and `pendingQuotations` semantics. Quotations have no `vatTotal`/QR in their print data (confirmed in Task 12's `buildOfflinePrintData`, which already branches on `kind`).

- [ ] **Step 7: Verify the app builds**

Run: `npx tsc --noEmit`
Expected: exits 0.

Run: `npx eslint src/components/receipts/receipt-form.tsx src/components/quotations/quotation-form.tsx src/app/\(app\)/receipts/new/page.tsx src/app/\(app\)/quotations/new/page.tsx`
Expected: no errors.

- [ ] **Step 8: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — every existing test, since this task didn't touch any API route logic, only client components and two page files.

- [ ] **Step 9: Commit**

```bash
git add src/app/\(app\)/receipts/new/page.tsx src/app/\(app\)/quotations/new/page.tsx src/components/receipts/receipt-form.tsx src/components/quotations/quotation-form.tsx src/lib/i18n/dictionaries
git commit -m "Wire offline save/print into New Receipt and New Quotation"
```

---

### Task 14: Offline status indicator + background replay trigger

**Files:**
- Create: `src/components/offline/offline-status-indicator.tsx`
- Modify: `src/components/shell/app-shell.tsx`

**Interfaces:**
- Consumes: `useOnlineStatus` (Task 11), `pendingCount`/`replayPending` (Task 10).

- [ ] **Step 1: Check `AppShell`'s header structure**

Run: `grep -n "header\|Header" src/components/shell/app-shell.tsx` to find where header-level chrome (e.g. the existing language switcher or user menu) is rendered, so the indicator can sit alongside it.

- [ ] **Step 2: Build the indicator**

Create `src/components/offline/offline-status-indicator.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { WifiOffIcon } from "lucide-react";
import { useOnlineStatus } from "@/lib/offline/connectivity";
import { pendingCount, replayPending } from "@/lib/offline/outbox";
import { useLocale } from "@/lib/i18n/language-provider";

const RETRY_INTERVAL_MS = 30000;

export function OfflineStatusIndicator() {
  const { dict } = useLocale();
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refreshCount() {
      const [receipts, quotations] = await Promise.all([pendingCount("receipt"), pendingCount("quotation")]);
      if (!cancelled) setPending(receipts + quotations);
    }

    refreshCount();

    async function trySync() {
      if (!online) return;
      const [receiptResult, quotationResult] = await Promise.all([replayPending("receipt"), replayPending("quotation")]);
      if (!cancelled) setAuthExpired(receiptResult.authExpired || quotationResult.authExpired);
      await refreshCount();
    }

    trySync();
    const interval = setInterval(trySync, RETRY_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [online]);

  if (online && pending === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm text-warning-fg">
      <WifiOffIcon className="size-4" />
      {!online
        ? dict.offline.offlineBadge
        : authExpired
          ? dict.offline.authExpiredBadge(pending)
          : dict.offline.pendingSyncBadge(pending)}
    </div>
  );
}
```

- [ ] **Step 3: Add the dictionary entries**

In `src/lib/i18n/dictionaries/dictionary.types.ts`, add a new top-level section:

```ts
  offline: {
    offlineBadge: string;
    pendingSyncBadge: (count: number) => string;
    authExpiredBadge: (count: number) => string;
  };
```

In `src/lib/i18n/dictionaries/en.ts`:

```ts
  offline: {
    offlineBadge: "Offline — sales will sync when reconnected",
    pendingSyncBadge: (count) => `Offline — ${count} sale${count === 1 ? "" : "s"} pending sync`,
    authExpiredBadge: (count) => `Please log in again to finish syncing ${count} sale${count === 1 ? "" : "s"}`,
  },
```

In `src/lib/i18n/dictionaries/ar.ts`:

```ts
  offline: {
    offlineBadge: "غير متصل — ستتم مزامنة المبيعات عند عودة الاتصال",
    pendingSyncBadge: (count) => `غير متصل — ${count} عملية بيع بانتظار المزامنة`,
    authExpiredBadge: (count) => `يرجى تسجيل الدخول مرة أخرى لإتمام مزامنة ${count} عملية بيع`,
  },
```

- [ ] **Step 4: Mount it in `AppShell`**

In `src/components/shell/app-shell.tsx`, import `OfflineStatusIndicator` and render it in the header area found in Step 1, alongside the existing header controls.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 6: Browser check**

Start the dev server (`npm run dev`), open the app, confirm no indicator shows while online with an empty outbox. This will be re-verified fully offline in Task 16.

- [ ] **Step 7: Commit**

```bash
git add src/components/offline/offline-status-indicator.tsx src/components/shell/app-shell.tsx src/lib/i18n/dictionaries
git commit -m "Add offline/pending-sync status indicator to the app shell"
```

---

### Task 15: PWA manifest, icons, and service worker

**Files:**
- Create: `public/manifest.json`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png` (generated from the existing favicon)
- Create: `public/sw.js`
- Modify: `src/app/(app)/layout.tsx` (or the root layout — check which already renders `<head>` metadata) to link the manifest and register the service worker
- Modify: `next.config.ts` if needed for static asset headers (only if the manual check in Step 5 finds an issue)

- [ ] **Step 1: Locate the existing favicon asset**

Run: `find public -iname "*favicon*" -o -iname "*icon*"` (per the deployment memory, a favicon asset already exists from an earlier session).

Generate two PNGs from it at 192x192 and 512x512 — if no image-processing tool is available in this environment, note the exact source file found and ask the user for exported PNGs at those two sizes rather than guessing at a conversion tool.

- [ ] **Step 2: Write the manifest**

Create `public/manifest.json`:

```json
{
  "name": "FatooraSync",
  "short_name": "FatooraSync",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

(Confirm `theme_color` against this repo's actual primary token in `src/app/globals.css` before finalizing — use the same value the rest of the app already treats as its brand color, don't introduce a new one.)

- [ ] **Step 3: Write the service worker**

Create `public/sw.js`:

```js
const SHELL_CACHE = "fatoorasync-shell-v1";
const OFFLINE_ROUTES = ["/receipts/new", "/quotations/new"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Network-first, falling back to the last successfully cached response, for
// the two navigable routes this feature makes offline-capable. Every other
// route is intentionally left untouched -- it simply won't load offline,
// per the scope boundary in the design spec.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isOfflineRoute = event.request.mode === "navigate" && OFFLINE_ROUTES.includes(url.pathname);
  const isStaticAsset = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

  if (!isOfflineRoute && !isStaticAsset) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
```

- [ ] **Step 4: Register the service worker and link the manifest**

Find the app's root layout (check `src/app/layout.tsx` for the `<html>`/`<head>` shell — this is separate from `(app)/layout.tsx`, which only wraps authenticated pages).

Add to its `<head>` (or `metadata` export, matching however this file already declares `<title>`/favicon links):

```tsx
<link rel="manifest" href="/manifest.json" />
```

Add a small client component to register the service worker. Create `src/components/offline/service-worker-registration.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
```

Render `<ServiceWorkerRegistration />` once in the root layout, alongside the rest of the page shell.

- [ ] **Step 5: Verify the manifest and worker are served correctly**

Run: `npm run build && npm run start` (production build — the registration guard in Step 4 only activates outside dev).

Using the browser tools: open the app, check DevTools → Application → Manifest shows "FatooraSync" with both icon sizes, and Application → Service Workers shows `sw.js` activated.

- [ ] **Step 6: Commit**

```bash
git add public/manifest.json public/icons public/sw.js src/app/layout.tsx src/components/offline/service-worker-registration.tsx
git commit -m "Add PWA manifest and service worker for offline app-shell caching"
```

---

### Task 16: End-to-end offline verification (manual, no new files)

This is the one path Task 1-15's automated tests cannot cover — a real browser losing and regaining connectivity mid-flow. Per this project's verification standard, this must be checked live before the feature is considered done.

- [ ] **Step 1: Build and run the production server**

Run: `npm run build && npm run start`

- [ ] **Step 2: Warm the cache**

Using the browser tools, log in, navigate to `/receipts/new`, confirm it loads normally. This is the visit that populates the Dexie cache and leases the first number block (Tasks 9/13).

- [ ] **Step 3: Go offline and create a sale**

Using DevTools → Network → "Offline" (or the browser tools' equivalent), simulate zero connectivity. Reload `/receipts/new` — confirm it still loads (service worker's cached navigation response, Task 15) with products/customers populated (Dexie, Task 13). Add a line item, save with "Save & Print." Confirm:
- The offline status indicator (Task 14) appears.
- A receipt renders in the print modal with a real, final invoice number.
- No network errors are thrown to the console beyond the expected failed `fetch` to `/api/receipts`.

- [ ] **Step 4: Reconnect and confirm sync**

Turn the network back on. Within ~30 seconds (the outbox's retry interval, Task 10), confirm:
- The offline status indicator disappears.
- The receipt now appears in `/receipts` (the history list) with the same number it was printed with.
- `npx prisma studio` (or a direct query) confirms exactly one `Document` row exists for that uuid — not a duplicate.

- [ ] **Step 5: Repeat Steps 2-4 for `/quotations/new`**

Same walkthrough, confirming a quotation syncs correctly and appears in `/quotations` history.

- [ ] **Step 6: Report results**

Summarize what was verified (and any deviation from expected behavior) back to the user — this task has no commit of its own since it produces no code changes, only confirmation that Tasks 1-15 work together as designed.
