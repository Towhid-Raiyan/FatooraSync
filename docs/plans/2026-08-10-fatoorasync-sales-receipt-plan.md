# FatooraSync Sales Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Sales Receipt creation, save, and print — the third of the phased feature builds on top of the design system foundation (Customers and Products shipped first). Quotation and Sales History are explicitly out of scope for this cycle; they're future cycles reusing this same engine.

**Architecture:** A shared pure-calculation layer (`src/lib/receipts/calculate-totals.ts`) is used by both the client (live totals while building a receipt) and the server (authoritative totals at save time), so the two can never disagree except by the deliberate trust-boundary rule in Task 2. `POST /api/receipts` performs the whole save — customer resolution, server-side product re-read, invoice numbering, hash chaining, document+line creation, stock decrement — as one raw `prisma.$transaction` with fully explicit tenant filtering throughout (not `withTenant()` — see Task 2's Global Constraints for why). The `/receipts/new` page is a Server Component that fetches the tenant's customer and product lists once, handing them to a Client Component that owns all the interactive drafting state; `/receipts/[id]/print` is a separate Server Component with no client state at all.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma, Tailwind CSS v4, shadcn/ui (existing components — `Dialog`, `Table`, `Checkbox`, `Badge`, `Button`, `Input`, `Label`, `Card`, all already installed), `qrcode` npm package (new, Task 4 only, for rendering the QR image).

## Global Constraints

- Design source of truth: `docs/specs/2026-08-10-fatoorasync-sales-receipt-design.md` — every field name, endpoint shape, and calculation rule in this plan is copied from there. If anything here seems to conflict with that spec, the spec governs; flag the conflict rather than guessing.
- **Receipts are immutable once saved.** No `PATCH`, no `DELETE`, anywhere in this plan. "Editing" a receipt does not exist — that's explicitly Quotation's job in a future cycle.
- **The server never trusts client-supplied price, VAT rate, or product name for a line.** The request body carries only `{ productId, quantity }` per line. The server re-reads each product fresh, inside the save transaction, and that read is the only source of truth for what gets persisted. This is a security/correctness requirement, not a style preference — see the spec's §5 trust-boundary note.
- **Invoice numbering must be gapless.** `Tenant.nextSalesReceiptNumber` is only ever consumed inside the same transaction that creates the matching `Document` row — a failed save must never leave the counter incremented without a receipt to show for it.
- Round each line's subtotal/VAT/total to 2 decimals independently; sum the already-rounded line values for the document's subtotal/VAT/grand total. Never recompute the document totals from an unrounded aggregate.
- Reuse the design system's existing tokens and patterns exactly: card shadow `shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]` + `border border-border-subtle`, the label treatment `text-[10.5px] font-bold uppercase tracking-wider text-muted-fg`, `variant="primary"` for Save & Print (the primary action) and `variant="outline"` or plain/ghost styling for Save (secondary) — both live only in the Totals card, never duplicated elsewhere on the page.
- The Products section's existing `ProductFormDialog` (`src/components/products/product-form-dialog.tsx`) is reused as-is for the quick-create-product flow — do not duplicate its form fields into a second component. It already has no SKU field (SKU is system-generated, per the earlier Products revision).
- Testing: the MVP spec explicitly calls out VAT/total calculation and ZATCA TLV/QR encoding as things that must be tested "regardless of time pressure," alongside tenant isolation — Task 1's pure functions and Task 2's route tests cover exactly these. No new UI test tooling; the frontend is verified by manual browser testing during implementation, same as every prior cycle.
- Not in this plan: Quotation, Sales History, credit notes/returns, ZATCA Phase-2 live API/cryptographic signing, thermal ESC/POS printing, any Inventory-module stock-movement ledger.

---

## File Structure

```
prisma/
  schema.prisma                              (modify: Tenant gains nextSalesReceiptNumber, lastSalesReceiptHash)
src/
  lib/
    receipts/
      calculate-totals.ts                     (create)
      calculate-totals.test.ts                 (create)
    zatca/
      hash-chain.ts                            (create)
      hash-chain.test.ts                        (create)
      qr-payload.ts                             (create)
      qr-payload.test.ts                         (create)
  app/
    api/
      receipts/
        route.ts                                (create: POST)
        route.test.ts                            (create)
    (app)/
      receipts/
        new/
          page.tsx                              (create: Server Component)
        [id]/
          print/
            page.tsx                             (create: Server Component, print view)
  components/
    receipts/
      receipt-form.tsx                          (create: main client component)
      customer-section.tsx                      (create)
      items-section.tsx                         (create)
  components/shell/
    nav-items.ts                                (modify: "New Receipt" href null -> /receipts/new)
```

---

### Task 1: Schema migration + shared calculation and ZATCA pure functions

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/receipts/calculate-totals.ts`, `src/lib/receipts/calculate-totals.test.ts`
- Create: `src/lib/zatca/hash-chain.ts`, `src/lib/zatca/hash-chain.test.ts`
- Create: `src/lib/zatca/qr-payload.ts`, `src/lib/zatca/qr-payload.test.ts`

**Interfaces:**
- Produces: `round2`, `calculateLine`, `calculateDocumentTotals` from `@/lib/receipts/calculate-totals` — used by both Task 2 (server) and Task 3 (client, for live totals). `computeInvoiceHash`, `GENESIS_HASH` from `@/lib/zatca/hash-chain` and `buildZatcaQrPayload` from `@/lib/zatca/qr-payload` — used by Task 2. All are pure functions: deterministic input in, deterministic output out, no I/O, no Prisma/Next.js imports, safe to import from both server and client code.

- [ ] **Step 1: Add the Tenant fields**

In `prisma/schema.prisma`, add to the `Tenant` model (alongside the existing `nextProductSkuNumber` field from the Products cycle):

```prisma
model Tenant {
  // ...existing fields...
  nextProductSkuNumber   Int     @default(1)
  nextSalesReceiptNumber Int     @default(1)
  lastSalesReceiptHash   String?
  // ...existing relations...
}
```

Run `npx prisma format` to fix alignment, then:

```bash
npx prisma migrate dev --name add_sales_receipt_counter_and_hash
```

Expected: a new migration directory under `prisma/migrations/`, applied successfully, Prisma Client regenerated.

- [ ] **Step 2: Create the shared totals-calculation module**

Create `src/lib/receipts/calculate-totals.ts`:

```typescript
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface LineInput {
  unitPrice: number;
  quantity: number;
  vatRate: number;
}

export interface LineTotals {
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
}

export function calculateLine(input: LineInput): LineTotals {
  const lineSubtotal = round2(input.unitPrice * input.quantity);
  const lineVat = round2((lineSubtotal * input.vatRate) / 100);
  const lineTotal = round2(lineSubtotal + lineVat);
  return { lineSubtotal, lineVat, lineTotal };
}

export interface DocumentTotals {
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
}

export function calculateDocumentTotals(lines: LineTotals[]): DocumentTotals {
  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineSubtotal, 0));
  const vatTotal = round2(lines.reduce((sum, line) => sum + line.lineVat, 0));
  const grandTotal = round2(subtotal + vatTotal);
  return { subtotal, vatTotal, grandTotal };
}
```

- [ ] **Step 3: Test the totals calculation**

Create `src/lib/receipts/calculate-totals.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { round2, calculateLine, calculateDocumentTotals } from "./calculate-totals";

describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    expect(round2(10.005)).toBe(10.01);
    expect(round2(10.004)).toBe(10);
    expect(round2(10)).toBe(10);
  });
});

describe("calculateLine", () => {
  it("computes subtotal, VAT, and total for a standard 15% line", () => {
    const result = calculateLine({ unitPrice: 10, quantity: 2, vatRate: 15 });
    expect(result).toEqual({ lineSubtotal: 20, lineVat: 3, lineTotal: 23 });
  });

  it("computes a zero-VAT (exempt) line correctly", () => {
    const result = calculateLine({ unitPrice: 10, quantity: 3, vatRate: 0 });
    expect(result).toEqual({ lineSubtotal: 30, lineVat: 0, lineTotal: 30 });
  });

  it("rounds a line with a fractional quantity and price", () => {
    const result = calculateLine({ unitPrice: 4.99, quantity: 3, vatRate: 15 });
    // subtotal = 14.97, vat = 14.97 * 0.15 = 2.2455 -> rounds to 2.25
    expect(result).toEqual({ lineSubtotal: 14.97, lineVat: 2.25, lineTotal: 17.22 });
  });
});

describe("calculateDocumentTotals", () => {
  it("sums already-rounded line values rather than recomputing from an aggregate", () => {
    const lines = [
      calculateLine({ unitPrice: 10, quantity: 1, vatRate: 15 }), // 10 / 1.5 / 11.5
      calculateLine({ unitPrice: 4.99, quantity: 3, vatRate: 15 }), // 14.97 / 2.25 / 17.22
    ];
    const totals = calculateDocumentTotals(lines);
    expect(totals).toEqual({ subtotal: 24.97, vatTotal: 3.75, grandTotal: 28.72 });
  });

  it("returns all zeros for an empty line list", () => {
    expect(calculateDocumentTotals([])).toEqual({ subtotal: 0, vatTotal: 0, grandTotal: 0 });
  });
});
```

- [ ] **Step 4: Create the hash-chain module**

Create `src/lib/zatca/hash-chain.ts`:

```typescript
import { createHash } from "crypto";

// Fixed genesis value: a tenant's first-ever sales receipt has no prior receipt
// to chain from.
export const GENESIS_HASH = "0";

export interface HashChainInput {
  previousInvoiceHash: string | null;
  uuid: string;
  grandTotal: string;
  vatTotal: string;
  createdAt: string; // ISO 8601
}

// Phase-1 ZATCA readiness, not real cryptographic signing (that's Phase 2, which
// needs live ZATCA onboarding -- out of MVP scope). Deterministic SHA-256 over the
// receipt's core fields, chained to the previous receipt's hash, so a later
// cryptographic replacement doesn't need to restructure historical records.
export function computeInvoiceHash(input: HashChainInput): string {
  const previous = input.previousInvoiceHash ?? GENESIS_HASH;
  const payload = `${previous}${input.uuid}${input.grandTotal}${input.vatTotal}${input.createdAt}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
```

- [ ] **Step 5: Test the hash chain**

Create `src/lib/zatca/hash-chain.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeInvoiceHash, GENESIS_HASH } from "./hash-chain";

describe("computeInvoiceHash", () => {
  const baseInput = {
    previousInvoiceHash: null as string | null,
    uuid: "11111111-1111-1111-1111-111111111111",
    grandTotal: "115.00",
    vatTotal: "15.00",
    createdAt: "2026-08-10T12:00:00.000Z",
  };

  it("is deterministic for the same input", () => {
    expect(computeInvoiceHash(baseInput)).toBe(computeInvoiceHash(baseInput));
  });

  it("treats a null previousInvoiceHash the same as the genesis hash", () => {
    const withNull = computeInvoiceHash({ ...baseInput, previousInvoiceHash: null });
    const withGenesis = computeInvoiceHash({ ...baseInput, previousInvoiceHash: GENESIS_HASH });
    expect(withNull).toBe(withGenesis);
  });

  it("produces a different hash for a different previousInvoiceHash", () => {
    const first = computeInvoiceHash({ ...baseInput, previousInvoiceHash: null });
    const second = computeInvoiceHash({ ...baseInput, previousInvoiceHash: "some-prior-hash" });
    expect(first).not.toBe(second);
  });

  it("produces a different hash for a different grandTotal", () => {
    const first = computeInvoiceHash(baseInput);
    const second = computeInvoiceHash({ ...baseInput, grandTotal: "200.00" });
    expect(first).not.toBe(second);
  });

  it("produces a 64-character lowercase hex string (SHA-256)", () => {
    expect(computeInvoiceHash(baseInput)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 6: Create the QR payload module**

Create `src/lib/zatca/qr-payload.ts`:

```typescript
export interface QrPayloadInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string; // ISO 8601
  invoiceTotal: string;
  vatTotal: string;
}

function encodeTlv(tag: number, value: string): Buffer {
  const valueBytes = Buffer.from(value, "utf8");
  if (valueBytes.length > 255) {
    throw new Error(`ZATCA QR field for tag ${tag} exceeds the 255-byte TLV length limit`);
  }
  return Buffer.concat([Buffer.from([tag, valueBytes.length]), valueBytes]);
}

// Standard ZATCA Phase-1 simplified-invoice QR structure: 5 TLV (Tag-Length-Value)
// fields concatenated in tag order, then Base64-encoded as a whole. Pure local
// computation, no external ZATCA API dependency.
export function buildZatcaQrPayload(input: QrPayloadInput): string {
  const tlvs = [
    encodeTlv(1, input.sellerName),
    encodeTlv(2, input.vatNumber),
    encodeTlv(3, input.timestamp),
    encodeTlv(4, input.invoiceTotal),
    encodeTlv(5, input.vatTotal),
  ];
  return Buffer.concat(tlvs).toString("base64");
}
```

- [ ] **Step 7: Test the QR payload, including a round-trip decode**

Create `src/lib/zatca/qr-payload.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildZatcaQrPayload } from "./qr-payload";

function decodeTlv(buffer: Buffer): Array<{ tag: number; value: string }> {
  const result: Array<{ tag: number; value: string }> = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = buffer[offset];
    const length = buffer[offset + 1];
    const value = buffer.subarray(offset + 2, offset + 2 + length).toString("utf8");
    result.push({ tag, value });
    offset += 2 + length;
  }
  return result;
}

describe("buildZatcaQrPayload", () => {
  const input = {
    sellerName: "Demo Trading Establishment",
    vatNumber: "300000000000099",
    timestamp: "2026-08-10T12:00:00.000Z",
    invoiceTotal: "115.00",
    vatTotal: "15.00",
  };

  it("round-trips through TLV decoding with the exact original field values", () => {
    const payload = buildZatcaQrPayload(input);
    const decoded = decodeTlv(Buffer.from(payload, "base64"));
    expect(decoded).toEqual([
      { tag: 1, value: input.sellerName },
      { tag: 2, value: input.vatNumber },
      { tag: 3, value: input.timestamp },
      { tag: 4, value: input.invoiceTotal },
      { tag: 5, value: input.vatTotal },
    ]);
  });

  it("produces a valid Base64 string", () => {
    const payload = buildZatcaQrPayload(input);
    expect(() => Buffer.from(payload, "base64")).not.toThrow();
    expect(payload).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("throws if a field value exceeds 255 UTF-8 bytes", () => {
    const tooLong = "x".repeat(256);
    expect(() => buildZatcaQrPayload({ ...input, sellerName: tooLong })).toThrow();
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- lib/receipts lib/zatca`
Expected: all tests pass (7 in `calculate-totals.test.ts`, 5 in `hash-chain.test.ts`, 3 in `qr-payload.test.ts`).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/receipts src/lib/zatca
git commit -m "Add the sales receipt counter/hash fields and the calculation and ZATCA pure functions"
```

---

### Task 2: Sales receipt save API (the transaction)

**Files:**
- Create: `src/app/api/receipts/route.ts`
- Create: `src/app/api/receipts/route.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth/config`, `prisma` from `@/lib/db/client` (raw client, not `withTenant` — see this task's Global Constraints reminder below), `round2`/`calculateLine`/`calculateDocumentTotals` from `@/lib/receipts/calculate-totals`, `computeInvoiceHash`/`GENESIS_HASH` from `@/lib/zatca/hash-chain`, `buildZatcaQrPayload` from `@/lib/zatca/qr-payload` (Task 1).
- Produces: `POST /api/receipts` — body `{ customerId?: string, newCustomer?: { name, vatId?, crNumber?, phone?, address? }, lines: [{ productId: string, quantity: string|number }], notes?: string }`, returns the created `Document` (with its `lines`) on success, 201. Used by Task 3's frontend via `fetch`.

**Reminder — read this before writing the route:** this route uses a raw `prisma.$transaction(...)`, not `withTenant()`. Every read inside the transaction must explicitly filter by `tenantId` (use `findFirst`, not `findUnique`, since `findUnique` can't take a compound non-unique `where`); every write must explicitly stamp `tenantId`. The spec's §8 explains why in detail — read it before writing this file, it's short.

- [ ] **Step 1: Create the route**

Create `src/app/api/receipts/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { calculateLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import { computeInvoiceHash, GENESIS_HASH } from "@/lib/zatca/hash-chain";
import { buildZatcaQrPayload } from "@/lib/zatca/qr-payload";

class ReceiptError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RawLine {
  productId?: unknown;
  quantity?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const body = await request.json();

  const rawLines: RawLine[] = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "Add at least one item" }, { status: 400 });
  }

  const parsedLines: { productId: string; quantity: number }[] = [];
  for (const line of rawLines) {
    const quantity = Number(line.quantity);
    if (typeof line.productId !== "string" || !Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Each item must have a positive quantity" }, { status: 400 });
    }
    parsedLines.push({ productId: line.productId, quantity });
  }

  const hasExistingCustomer = typeof body.customerId === "string" && body.customerId.length > 0;
  const newCustomer = body.newCustomer;
  let newCustomerName = "";
  if (!hasExistingCustomer) {
    newCustomerName = typeof newCustomer?.name === "string" ? newCustomer.name.trim() : "";
    if (!newCustomerName) {
      return NextResponse.json({ error: "A customer is required" }, { status: 400 });
    }
  }

  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes : null;

  try {
    const document = await prisma.$transaction(async (txn) => {
      const settings = await txn.settings.findUniqueOrThrow({ where: { tenantId } });

      let customerId: string;
      if (hasExistingCustomer) {
        const existing = await txn.customer.findFirst({ where: { id: body.customerId, tenantId } });
        if (!existing) throw new ReceiptError("Selected customer not found", 400);
        customerId = existing.id;
      } else {
        const created = await txn.customer.create({
          data: {
            tenantId,
            name: newCustomerName,
            vatId: newCustomer?.vatId || null,
            crNumber: newCustomer?.crNumber || null,
            phone: newCustomer?.phone || null,
            address: newCustomer?.address || null,
          } as Prisma.CustomerUncheckedCreateInput,
        });
        customerId = created.id;
      }

      const resolvedLines: {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        vatRate: number;
        lineSubtotal: number;
        lineVat: number;
        lineTotal: number;
      }[] = [];

      for (const line of parsedLines) {
        const product = await txn.product.findFirst({
          where: { id: line.productId, tenantId, isActive: true },
        });
        if (!product) {
          throw new ReceiptError("One or more items are no longer available", 400);
        }
        const unitPrice = Number(product.unitPrice);
        const vatRate = product.vatRate !== null ? Number(product.vatRate) : Number(settings.defaultVatRate);
        const { lineSubtotal, lineVat, lineTotal } = calculateLine({ unitPrice, quantity: line.quantity, vatRate });
        resolvedLines.push({
          productId: product.id,
          productName: product.nameEn,
          quantity: line.quantity,
          unitPrice,
          vatRate,
          lineSubtotal,
          lineVat,
          lineTotal,
        });
      }

      const { subtotal, vatTotal, grandTotal } = calculateDocumentTotals(resolvedLines);

      const tenantCounters = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: 1 } },
        select: { nextSalesReceiptNumber: true, lastSalesReceiptHash: true },
      });
      const number = tenantCounters.nextSalesReceiptNumber - 1;
      const previousInvoiceHash = tenantCounters.lastSalesReceiptHash ?? GENESIS_HASH;

      const uuid = randomUUID();
      const createdAt = new Date();
      const invoiceHash = computeInvoiceHash({
        previousInvoiceHash,
        uuid,
        grandTotal: grandTotal.toFixed(2),
        vatTotal: vatTotal.toFixed(2),
        createdAt: createdAt.toISOString(),
      });

      const tenant = await txn.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const qrCode = buildZatcaQrPayload({
        sellerName: tenant.legalName,
        vatNumber: tenant.vatNumber,
        timestamp: createdAt.toISOString(),
        invoiceTotal: grandTotal.toFixed(2),
        vatTotal: vatTotal.toFixed(2),
      });

      const created = await txn.document.create({
        data: {
          tenantId,
          type: "SALES_RECEIPT",
          number,
          customerId,
          subtotal,
          vatTotal,
          grandTotal,
          notes,
          uuid,
          invoiceHash,
          previousInvoiceHash,
          qrCode,
          createdAt,
          lines: {
            create: resolvedLines.map((line) => ({
              tenantId,
              productId: line.productId,
              productName: line.productName,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatRate: line.vatRate,
              lineSubtotal: line.lineSubtotal,
              lineVat: line.lineVat,
              lineTotal: line.lineTotal,
            })),
          },
        } as Prisma.DocumentUncheckedCreateInput,
        include: { lines: true },
      });

      for (const line of resolvedLines) {
        await txn.product.update({
          where: { id: line.productId },
          data: { quantity: { decrement: line.quantity } },
        });
      }

      await txn.tenant.update({
        where: { id: tenantId },
        data: { lastSalesReceiptHash: invoiceHash },
      });

      return created;
    });

    return NextResponse.json(document, { status: 201 });
  } catch (err) {
    if (err instanceof ReceiptError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "This VAT ID is already used by another customer" }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Create the test file**

Create `src/app/api/receipts/route.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST } from "./route";

let tenantId: string;
let otherTenantId: string;
let walkInCustomerId: string;
let productId: string;
let productWithVatOverrideId: string;
let otherTenantProductId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/receipts", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/receipts", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Receipts Test Co", tradeNameEn: "Receipts Test Shop", vatNumber: "300000000000105" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });

    const walkIn = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    walkInCustomerId = walkIn.id;

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Rice 5kg", unitPrice: 20, quantity: 5 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productId = product.id;

    const productWithVat = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Exempt Item", unitPrice: 10, vatRate: 0, quantity: 100 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productWithVatOverrideId = productWithVat.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Receipts Co", tradeNameEn: "Other Receipts Shop", vatNumber: "300000000000112" },
    });
    otherTenantId = otherTenant.id;
    await prisma.settings.create({ data: { tenantId: otherTenantId, defaultVatRate: 15 } });
    const otherProduct = await withTenant(otherTenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Other Tenant Product", unitPrice: 1, quantity: 10 } as Prisma.ProductUncheckedCreateInput })
    );
    otherTenantProductId = otherProduct.id;
  });

  afterAll(async () => {
    await prisma.documentLine.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("creates a receipt, decrements stock, and computes totals from the server-read product", async () => {
    const response = await POST(
      postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "2" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.number).toBe(1);
    expect(body.subtotal).toBe("40");
    expect(body.vatTotal).toBe("6");
    expect(body.grandTotal).toBe("46");
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].productName).toBe("Rice 5kg");

    const product = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(product.quantity.toString()).toBe("3"); // 5 - 2
  });

  it("uses the product's own VAT override instead of the tenant default", async () => {
    const response = await POST(
      postRequest({ customerId: walkInCustomerId, lines: [{ productId: productWithVatOverrideId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vatTotal).toBe("0");
  });

  it("ignores a client-supplied price/VAT/name and uses the server's own product read", async () => {
    const response = await POST(
      postRequest({
        customerId: walkInCustomerId,
        lines: [
          {
            productId,
            quantity: "1",
            unitPrice: "999999.99",
            vatRate: "0",
            productName: "Forged Line Item",
          },
        ],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines[0].unitPrice).toBe("20");
    expect(body.lines[0].productName).toBe("Rice 5kg");
    expect(body.grandTotal).toBe("23"); // 20 * 1.15, not the forged total
  });

  it("assigns sequential receipt numbers and chains the hash", async () => {
    const first = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "1" }] }));
    const second = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "1" }] }));
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.number).toBe(firstBody.number + 1);
    expect(secondBody.previousInvoiceHash).toBe(firstBody.invoiceHash);
  });

  it("creates a new customer inline when newCustomer is provided instead of customerId", async () => {
    const response = await POST(
      postRequest({
        newCustomer: { name: "Fresh Customer", phone: "0500000000" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.name).toBe("Fresh Customer");
  });

  it("allows stock to go negative without blocking the save", async () => {
    const response = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "999" }] }));
    expect(response.status).toBe(201);
    const product = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(Number(product.quantity)).toBeLessThan(0);
  });

  it("returns 400 for an empty line list", async () => {
    const response = await POST(postRequest({ customerId: walkInCustomerId, lines: [] }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-positive quantity", async () => {
    const response = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "0" }] }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a productId belonging to another tenant", async () => {
    const response = await POST(
      postRequest({ customerId: walkInCustomerId, lines: [{ productId: otherTenantProductId, quantity: "1" }] })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a customerId belonging to another tenant", async () => {
    const otherCustomer = await withTenant(otherTenantId, (tx) =>
      tx.customer.create({ data: { name: "Other Tenant Customer" } as Prisma.CustomerUncheckedCreateInput })
    );
    const response = await POST(
      postRequest({ customerId: otherCustomer.id, lines: [{ productId, quantity: "1" }] })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when neither customerId nor newCustomer is provided", async () => {
    const response = await POST(postRequest({ lines: [{ productId, quantity: "1" }] }));
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await POST(postRequest({ customerId: walkInCustomerId, lines: [{ productId, quantity: "1" }] }));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test -- receipts/route.test.ts`
Expected: all 13 tests pass.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/receipts/route.ts src/app/api/receipts/route.test.ts
git commit -m "Add the sales receipt save API"
```

---

### Task 3: New Receipt page — customer section, items section, notes, totals, save

**Files:**
- Create: `src/app/(app)/receipts/new/page.tsx`
- Create: `src/components/receipts/receipt-form.tsx`
- Create: `src/components/receipts/customer-section.tsx`
- Create: `src/components/receipts/items-section.tsx`
- Modify: `src/components/shell/nav-items.ts`

**Interfaces:**
- Consumes: `auth`/`prisma`/`withTenant` (page.tsx, initial data fetch); `POST /api/receipts` (Task 2, via `fetch`); `POST /api/products` and the existing `ProductFormDialog` from `@/components/products/product-form-dialog` (reused as-is for the quick-create-product flow) and its `SerializedProduct` type from `@/components/products/products-client`; `Button`/`Input`/`Label`/`Card`/`Table`-family from `@/components/ui/*`.

- [ ] **Step 1: Enable the New Receipt nav link**

In `src/components/shell/nav-items.ts`, change:

```typescript
{ label: "New Receipt", href: null },
```

to:

```typescript
{ label: "New Receipt", href: "/receipts/new" },
```

- [ ] **Step 2: Create the page (Server Component)**

Create `src/app/(app)/receipts/new/page.tsx`:

```tsx
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { ReceiptForm } from "@/components/receipts/receipt-form";

export default async function NewReceiptPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [customers, products, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      tx.product.findMany({ where: { isActive: true }, orderBy: { nameEn: "asc" } }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );

  // Decimal fields can't cross the Server -> Client Component boundary as raw
  // Prisma Decimal instances -- convert to strings first (same reasoning as the
  // Products page).
  const serializedProducts = products.map((p) => ({
    ...p,
    unitPrice: p.unitPrice.toString(),
    vatRate: p.vatRate?.toString() ?? null,
    quantity: p.quantity.toString(),
  }));

  return (
    <ReceiptForm
      initialCustomers={customers}
      initialProducts={serializedProducts}
      defaultVatRate={settings.defaultVatRate.toString()}
    />
  );
}
```

- [ ] **Step 3: Create the customer section component**

Create `src/components/receipts/customer-section.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface NewCustomerDraft {
  name: string;
  vatId: string;
  crNumber: string;
  phone: string;
  address: string;
}

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

interface CustomerSectionProps {
  customers: Customer[];
  selectedCustomerId: string | null;
  addingNew: boolean;
  newCustomerDraft: NewCustomerDraft;
  onSelectCustomer: (id: string) => void;
  onStartAddNew: () => void;
  onCancelAddNew: () => void;
  onNewCustomerDraftChange: (draft: NewCustomerDraft) => void;
}

export function CustomerSection({
  customers,
  selectedCustomerId,
  addingNew,
  newCustomerDraft,
  onSelectCustomer,
  onStartAddNew,
  onCancelAddNew,
  onNewCustomerDraftChange,
}: CustomerSectionProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(query) || (c.vatId ?? "").toLowerCase().includes(query)
    );
  }, [customers, search]);

  const selected = customers.find((c) => c.id === selectedCustomerId) ?? null;

  return (
    <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">Customer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {addingNew ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={LABEL_CLASS}>Name</Label>
                <Input
                  value={newCustomerDraft.name}
                  onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label className={LABEL_CLASS}>VAT ID</Label>
                <Input
                  value={newCustomerDraft.vatId}
                  onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, vatId: e.target.value })}
                />
              </div>
              <div>
                <Label className={LABEL_CLASS}>CR Number</Label>
                <Input
                  value={newCustomerDraft.crNumber}
                  onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, crNumber: e.target.value })}
                />
              </div>
              <div>
                <Label className={LABEL_CLASS}>Phone</Label>
                <Input
                  value={newCustomerDraft.phone}
                  onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, phone: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label className={LABEL_CLASS}>Address</Label>
              <Input
                value={newCustomerDraft.address}
                onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, address: e.target.value })}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onCancelAddNew}>
              Cancel, pick an existing customer instead
            </Button>
          </>
        ) : (
          <>
            <Input
              placeholder="Search by name or VAT ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {selected && (
              <div className="rounded-lg border border-border-subtle p-3 text-sm">
                <div className="font-medium text-heading">{selected.name}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-fg">
                  <div>VAT ID: {selected.vatId ?? "—"}</div>
                  <div>CR Number: {selected.crNumber ?? "—"}</div>
                  <div>Phone: {selected.phone ?? "—"}</div>
                  <div>Address: {selected.address ?? "—"}</div>
                </div>
              </div>
            )}
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border-subtle">
              {filtered.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => onSelectCustomer(customer.id)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-bg-app ${
                    customer.id === selectedCustomerId ? "bg-bg-app font-medium text-heading" : "text-body"
                  }`}
                >
                  {customer.name}
                  {customer.vatId && <span className="text-muted-fg"> — {customer.vatId}</span>}
                </button>
              ))}
              {filtered.length === 0 && <div className="px-3 py-2 text-sm text-muted-fg">No matches</div>}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onStartAddNew}>
              + Add new customer
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create the items section component**

Create `src/components/receipts/items-section.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { SerializedProduct } from "@/components/products/products-client";
import type { LineTotals } from "@/lib/receipts/calculate-totals";

export interface ReceiptLine {
  key: string;
  productId: string;
  sku: string | null;
  productName: string;
  quantity: string;
  unitPrice: string;
  vatRate: string | null;
  stockAtAdd: string;
}

interface ItemsSectionProps {
  products: SerializedProduct[];
  lines: ReceiptLine[];
  lineTotals: LineTotals[]; // same length/order as `lines` -- the resolved-VAT truth, computed once in ReceiptForm
  onAddLine: (product: SerializedProduct) => void;
  onRemoveLine: (key: string) => void;
  onQuantityChange: (key: string, quantity: string) => void;
  onOpenQuickCreate: () => void;
}

export function ItemsSection({
  products,
  lines,
  lineTotals,
  onAddLine,
  onRemoveLine,
  onQuantityChange,
  onOpenQuickCreate,
}: ItemsSectionProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return products.filter(
      (p) =>
        p.nameEn.toLowerCase().includes(query) ||
        (p.nameAr ?? "").toLowerCase().includes(query) ||
        (p.sku ?? "").toLowerCase().includes(query) ||
        (p.barcode ?? "").toLowerCase().includes(query)
    );
  }, [products, search]);

  function handleSelect(product: SerializedProduct) {
    onAddLine(product);
    setSearch("");
  }

  return (
    <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">Items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Input
            placeholder="Scan barcode or search by SKU / name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search.trim() && (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
              {filtered.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleSelect(product)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-bg-app"
                >
                  <span className="font-mono text-xs text-muted-fg">{product.sku}</span>{" "}
                  <span className="text-heading">{product.nameEn}</span>{" "}
                  <span className="text-muted-fg">— {product.unitPrice}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={onOpenQuickCreate}
                className="block w-full border-t border-border-subtle px-3 py-2 text-left text-sm font-medium text-primary hover:bg-bg-app"
              >
                + New Product
              </button>
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>VAT</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const exceedsStock = Number(line.quantity) > Number(line.stockAtAdd);
                return (
                  <TableRow key={line.key}>
                    <TableCell className="font-mono text-xs">{line.sku ?? "—"}</TableCell>
                    <TableCell>
                      {line.productName}
                      {exceedsStock && <div className="text-xs text-amber-600">exceeds stock</div>}
                    </TableCell>
                    <TableCell className="text-right">{line.unitPrice}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.001"
                        min="0.001"
                        value={line.quantity}
                        onChange={(e) => onQuantityChange(line.key, e.target.value)}
                        className="w-20 text-right"
                      />
                    </TableCell>
                    <TableCell>{line.vatRate === null ? "Default" : `${line.vatRate}%`}</TableCell>
                    <TableCell className="text-right">{lineTotals[index].lineTotal.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => onRemoveLine(line.key)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

`ItemsSection` never computes VAT itself — it only displays `lineTotals[index]`, which `ReceiptForm` (Step 5) computes once via the shared `calculateLine`, correctly resolving each line's VAT rate against the tenant's actual default when the product has no override. This is deliberate: an earlier draft of this plan had `ItemsSection` doing its own simplified inline arithmetic that silently treated every default-VAT product as 0% VAT (the client never knew the tenant's real default rate), which would have shown incorrect, understated totals on screen while the server correctly used the real rate at save time — a visible "why don't these numbers match" bug. Passing `lineTotals` down as already-resolved data removes the duplicate, divergent calculation entirely.

- [ ] **Step 5: Create the main form component**

Create `src/components/receipts/receipt-form.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import type { SerializedProduct } from "@/components/products/products-client";
import { calculateLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import { CustomerSection, type NewCustomerDraft } from "./customer-section";
import { ItemsSection, type ReceiptLine } from "./items-section";

const EMPTY_NEW_CUSTOMER: NewCustomerDraft = { name: "", vatId: "", crNumber: "", phone: "", address: "" };

interface ReceiptFormProps {
  initialCustomers: Customer[];
  initialProducts: SerializedProduct[];
  defaultVatRate: string;
}

export function ReceiptForm({ initialCustomers, initialProducts, defaultVatRate }: ReceiptFormProps) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [products, setProducts] = useState(initialProducts);

  const walkIn = customers.find((c) => c.isWalkIn) ?? null;
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(walkIn?.id ?? null);
  const [addingNewCustomer, setAddingNewCustomer] = useState(false);
  const [newCustomerDraft, setNewCustomerDraft] = useState<NewCustomerDraft>(EMPTY_NEW_CUSTOMER);

  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [notes, setNotes] = useState("");
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolves each line's VAT the same way the server does (Task 2): the product's
  // own override if it has one, otherwise the tenant's real default -- never a
  // hardcoded 0%, which would silently understate every default-VAT line's total
  // on screen relative to what actually gets saved.
  const lineTotals = useMemo(
    () =>
      lines.map((line) =>
        calculateLine({
          unitPrice: Number(line.unitPrice),
          quantity: Number(line.quantity),
          vatRate: Number(line.vatRate ?? defaultVatRate),
        })
      ),
    [lines, defaultVatRate]
  );
  const documentTotals = useMemo(() => calculateDocumentTotals(lineTotals), [lineTotals]);

  function addLine(product: SerializedProduct) {
    setLines((prev) => [
      ...prev,
      {
        key: `${product.id}-${prev.length}-${Date.now()}`,
        productId: product.id,
        sku: product.sku,
        productName: product.nameEn,
        quantity: "1",
        unitPrice: product.unitPrice,
        vatRate: product.vatRate,
        stockAtAdd: product.quantity,
      },
    ]);
  }

  function handleQuickCreateSaved(product: SerializedProduct) {
    setProducts((prev) => [...prev, product]);
    addLine(product);
    setQuickCreateOpen(false);
  }

  function resetForm() {
    setSelectedCustomerId(walkIn?.id ?? null);
    setAddingNewCustomer(false);
    setNewCustomerDraft(EMPTY_NEW_CUSTOMER);
    setLines([]);
    setNotes("");
    setError(null);
  }

  async function handleSave(printAfter: boolean) {
    if (lines.length === 0) {
      setError("Add at least one item");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      customerId: addingNewCustomer ? undefined : selectedCustomerId,
      newCustomer: addingNewCustomer ? newCustomerDraft : undefined,
      lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      notes,
    };

    try {
      const response = await fetch("/api/receipts", { method: "POST", body: JSON.stringify(payload) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Something went wrong");
        return;
      }

      if (printAfter) {
        router.push(`/receipts/${body.id}/print`);
      } else {
        resetForm();
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2 flex flex-col gap-4">
        <CustomerSection
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          addingNew={addingNewCustomer}
          newCustomerDraft={newCustomerDraft}
          onSelectCustomer={setSelectedCustomerId}
          onStartAddNew={() => {
            setAddingNewCustomer(true);
            setSelectedCustomerId(null);
          }}
          onCancelAddNew={() => {
            setAddingNewCustomer(false);
            setSelectedCustomerId(walkIn?.id ?? null);
          }}
          onNewCustomerDraftChange={setNewCustomerDraft}
        />

        <ItemsSection
          products={products}
          lines={lines}
          lineTotals={lineTotals}
          onAddLine={addLine}
          onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
          onQuantityChange={(key, quantity) =>
            setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)))
          }
          onOpenQuickCreate={() => setQuickCreateOpen(true)}
        />

        <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
          <CardHeader>
            <CardTitle className="text-heading">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-input bg-transparent p-2.5 text-sm"
              rows={3}
            />
          </CardContent>
        </Card>
      </div>

      <div className="col-span-1">
        <Card className="sticky top-4 border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
          <CardHeader>
            <CardTitle className="text-heading">Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-between text-sm text-body">
              <span>Subtotal</span>
              <span>{documentTotals.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-body">
              <span>Total VAT</span>
              <span>{documentTotals.vatTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-heading">
              <span>Grand Total</span>
              <span>{documentTotals.grandTotal.toFixed(2)}</span>
            </div>
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={saving}
              onClick={() => handleSave(true)}
            >
              {saving ? "Saving…" : "Save & Print"}
            </Button>
            <Button type="button" variant="outline" className="w-full" disabled={saving} onClick={() => handleSave(false)}>
              Save
            </Button>
          </CardContent>
        </Card>
      </div>

      <ProductFormDialog
        open={quickCreateOpen}
        product={null}
        onOpenChange={setQuickCreateOpen}
        onSaved={handleQuickCreateSaved}
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify it builds**

Run: `npm run typecheck`
Expected: no errors. `ProductFormDialog`'s `onSaved` prop expects `(product: SerializedProduct) => void` — confirm `handleQuickCreateSaved`'s signature matches exactly (read `src/components/products/product-form-dialog.tsx` if there's a mismatch).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, log in (`owner@demo.local` / `changeme123`), navigate to `/receipts/new` (now enabled in the sidebar).

Expected:
- Walk-in Customer is selected by default; searching finds other customers by name/VAT ID; "+ Add new customer" switches to editable fields.
- Searching in the Items section finds catalog products; selecting one adds a line with the catalog's price/VAT displayed; changing the Qty field updates that line's total and the Totals card live, with no network request.
- "+ New Product" (when a search finds nothing, or is always available at the bottom of results) opens the existing Product quick-create dialog; saving it adds the product to both the searchable list and the current receipt as a new line.
- A line whose quantity exceeds its `stockAtAdd` value shows the "exceeds stock" flag but doesn't block anything.
- Add a line for a product that has **no VAT override** (uses the tenant's default rate) and confirm its VAT column shows "Default" but its Line Total and the Totals card both reflect the tenant's real default VAT rate (e.g. 15%), not 0% — then save it and confirm the saved receipt's totals match what was shown on screen before saving.
- "Save" with at least one line succeeds and returns to a fresh blank receipt (Walk-in Customer re-selected, no lines, no notes).
- "Save & Print" succeeds and navigates to `/receipts/[id]/print` (expect a 404 there until Task 4 ships the print page — that's fine for this task, confirms the navigation itself works).
- Triggering a validation failure (e.g. temporarily removing all lines and clicking Save) shows the inline error without a page crash.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(app\)/receipts/new src/components/receipts src/components/shell/nav-items.ts
git commit -m "Add the new receipt page with customer/item entry, live totals, and save"
```

---

### Task 4: Receipt print page

**Files:**
- Create: `src/app/(app)/receipts/[id]/print/page.tsx`

**Interfaces:**
- Consumes: `auth`/`withTenant` (fetches the saved `Document` with its `lines` and `customer`), the `qrcode` npm package (new dependency, installed this task) to render `Document.qrCode` as an actual QR image.

- [ ] **Step 1: Install the QR rendering package**

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

- [ ] **Step 2: Create the print page**

Create `src/app/(app)/receipts/[id]/print/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export default async function ReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const document = await withTenant(tenantId, (tx) =>
    tx.document.findFirst({
      where: { id, type: "SALES_RECEIPT" },
      include: { lines: true, customer: true },
    })
  );
  if (!document) {
    notFound();
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const qrImageDataUrl = document.qrCode ? await QRCode.toDataURL(document.qrCode) : null;

  return (
    <div className="mx-auto max-w-[420px] bg-white p-6 text-sm text-black print:p-0" dir="rtl">
      <div className="mb-4 text-center">
        <div className="text-lg font-bold">{tenant.tradeNameAr ?? tenant.tradeNameEn}</div>
        <div className="text-base">{tenant.tradeNameEn}</div>
        <div className="mt-1 text-xs">
          {tenant.legalName} — VAT {tenant.vatNumber}
        </div>
        {tenant.address && <div className="text-xs">{tenant.address}</div>}
      </div>

      <div className="mb-3 flex justify-between text-xs">
        <span>
          فاتورة ضريبية مبسطة / Simplified Tax Invoice #{document.number}
        </span>
        <span>{document.createdAt.toISOString().slice(0, 19).replace("T", " ")}</span>
      </div>

      <div className="mb-3 border-t border-b border-black py-2 text-xs">
        <div>
          العميل / Customer: {document.customer.name}
        </div>
        {document.customer.vatId && <div>VAT ID: {document.customer.vatId}</div>}
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">المنتج / Item</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Price</th>
            <th className="py-1 text-right">VAT</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {document.lines.map((line) => (
            <tr key={line.id} className="border-b border-gray-300">
              <td className="py-1">{line.productName}</td>
              <td className="py-1 text-right">{line.quantity.toString()}</td>
              <td className="py-1 text-right">{line.unitPrice.toString()}</td>
              <td className="py-1 text-right">{line.lineVat.toString()}</td>
              <td className="py-1 text-right">{line.lineTotal.toString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span>الإجمالي الفرعي / Subtotal</span>
          <span>{document.subtotal.toString()}</span>
        </div>
        <div className="flex justify-between">
          <span>ضريبة القيمة المضافة / VAT Total</span>
          <span>{document.vatTotal.toString()}</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>الإجمالي / Grand Total</span>
          <span>{document.grandTotal.toString()}</span>
        </div>
      </div>

      {document.notes && <div className="mt-3 text-xs">Notes: {document.notes}</div>}

      {qrImageDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrImageDataUrl} alt="ZATCA QR code" className="mx-auto mt-4 h-32 w-32" />
      )}

      <style>{`
        @media print {
          nav, header, aside { display: none !important; }
        }
      `}</style>
    </div>
  );
}
```

Note: this page renders inside the `(app)` route group's `AppShell` (sidebar/topbar) like every other page in this codebase — the `@media print` rule above hides `nav`/`header`/`aside` so only the receipt content prints. If manual verification shows the shell chrome still interferes with the printed output, adjust the selectors to actually match `AppShell`'s rendered DOM structure (read `src/components/shell/app-shell.tsx` to confirm the real element/class names) rather than guessing further — this is a cosmetic print-CSS detail, not a logic change, safe to iterate on directly.

- [ ] **Step 3: Verify it builds**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manually verify in the browser**

Save a receipt via `/receipts/new` (Save & Print), confirm it navigates to `/receipts/[id]/print` and renders: tenant header, the receipt number, the line items with correct values, totals matching what was shown while building the receipt, and a real QR code image (not a broken image icon — confirm `qrImageDataUrl` actually resolved, e.g. via the Network tab or a computed-style/DOM check if screenshots aren't available in your environment).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/\(app\)/receipts/\[id\]/print/page.tsx
git commit -m "Add the receipt print page with the ZATCA QR code"
```
