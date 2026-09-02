# Credit Note Issuance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Owner or Cashier issue a credit note — partial or full — against a previously-saved sales receipt, restoring stock and chaining into the same ZATCA invoice-hash sequence as receipts.

**Architecture:** A new `CREDIT_NOTE` document type reuses the existing `Document`/`DocumentLine` tables (no new tables). A new self-relation on `DocumentLine` tracks which original line a credit-note line reverses, computed remaining-creditable quantity rather than mutating the original. The write path mirrors `src/app/api/receipts/route.ts`'s existing transaction shape closely: same hash-chain mechanism, same `applyStockMovement()` ledger, same tenant-counter-based numbering and locking idiom.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL (Neon), Vitest (route tests against a real database), React Server Components + one client form component, `@react-pdf/renderer` for PDF output.

**Spec:** [docs/superpowers/specs/2026-09-02-fatoorasync-credit-note-issuance-design.md](../specs/2026-09-02-fatoorasync-credit-note-issuance-design.md)

## Global Constraints

- Any signed-in tenant user (Owner or Cashier) may issue a credit note — no new role gate, same as receipt creation.
- Credit notes are online-only: no `NumberLease` entry, no offline outbox path.
- A credit note can only be issued against a `SALES_RECEIPT`, never against a `QUOTATION` or another `CREDIT_NOTE`.
- `DocumentLine` rows are never mutated once written — remaining-creditable quantity is always computed by summing linked credit-note lines, never stored redundantly on the original line.
- **The `Tenant.lastSalesReceiptHash` → `lastInvoiceHash` column rename MUST preserve existing data via `ALTER TABLE ... RENAME COLUMN`, never a drop-and-recreate.** This column holds the live ZATCA invoice-hash chain for tenants already in production; losing its value would break chain continuity for real, already-issued invoices.
- Every new API route follows the existing auth pattern exactly: `await auth()` → 401 if no `session.user.tenantId` → `assertTenantAccess(tenantId)` → tenant-scoped DB access via `withTenant()` (reads) or explicit `tenantId` in every `where`/`data` inside a raw `prisma.$transaction` (writes, matching `receipts/route.ts`'s own POST).
- All new user-facing strings go through `dict`/`useLocale()` — no hardcoded UI copy. API error messages stay plain English, matching every existing route in this codebase (`receipts/route.ts`, `quotations/route.ts`, `inventory/movements/route.ts`).
- Money fields round via `round2()`; unit price rounds via `round3()` — both already exported from `src/lib/receipts/calculate-totals.ts`, reused as-is.

---

### Task 1: Schema changes, migration, and the invoice-hash rename

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/app/api/receipts/route.ts:266,272,274,279,282,418` (rename `lastSalesReceiptHash` → `lastInvoiceHash`)
- Modify: `src/lib/tenant-deletion/build-archive.test.ts:11` (rename the same field in a test fixture)
- Create: `prisma/migrations/<timestamp>_add_credit_note_issuance/migration.sql`

**Interfaces:**
- Produces: `DocumentType.CREDIT_NOTE`, `StockMovementType.RETURN`, `Tenant.nextCreditNoteNumber: number`, `Tenant.lastInvoiceHash: string | null`, `DocumentLine.creditedForLineId: string | null` (self-relation to another `DocumentLine`), `DocumentLine.creditedForLine`, `DocumentLine.creditingLines: DocumentLine[]` — every later task in this plan relies on these exact names.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, change the `DocumentType` enum:

```prisma
enum DocumentType {
  SALES_RECEIPT
  QUOTATION
  CREDIT_NOTE
}
```

Change the `StockMovementType` enum:

```prisma
enum StockMovementType {
  SALE
  RESTOCK
  ADJUSTMENT
  RETURN
}
```

In `model Tenant`, add one field and rename another (keep every other field exactly where it is):

```prisma
  nextPurchaseReceiptNumber Int           @default(1)
  nextCreditNoteNumber      Int           @default(1)
  lastInvoiceHash           String?
```

(`lastInvoiceHash` replaces the existing `lastSalesReceiptHash` line — same position, new name.)

In `model DocumentLine`, add the self-relation and its index after the existing `lineTotal` field:

```prisma
  lineTotal    Decimal  @db.Decimal(12, 2)

  creditedForLineId String?
  creditedForLine   DocumentLine?  @relation("CreditedLine", fields: [creditedForLineId], references: [id])
  creditingLines    DocumentLine[] @relation("CreditedLine")

  @@index([documentId])
  @@index([tenantId])
  @@index([creditedForLineId])
```

- [ ] **Step 2: Generate the migration without applying it**

Run:
```bash
cd "D:\Project\FatooraSync"
npx prisma migrate dev --create-only --name add_credit_note_issuance
```

This writes `prisma/migrations/<timestamp>_add_credit_note_issuance/migration.sql` without touching the database yet.

- [ ] **Step 3: Fix the rename in the generated SQL**

Open the generated `migration.sql`. Prisma's diff will render the `lastSalesReceiptHash` → `lastInvoiceHash` change as a column **drop followed by an add** (something like `ALTER TABLE "Tenant" DROP COLUMN "lastSalesReceiptHash"; ... ALTER TABLE "Tenant" ADD COLUMN "lastInvoiceHash" TEXT;`). Find those two statements and replace them with a single rename:

```sql
ALTER TABLE "Tenant" RENAME COLUMN "lastSalesReceiptHash" TO "lastInvoiceHash";
```

Leave every other statement in the file (the new enum values, `nextCreditNoteNumber`, `creditedForLineId` + its FK + its index) exactly as generated. This is the one hand-edit this task requires — a drop-and-add would silently erase every live tenant's current invoice-hash chain value.

- [ ] **Step 4: Apply the migration**

```bash
npx prisma migrate dev
```

Expected: it applies the edited SQL file (no new diff, since the schema already matches). Confirm with `npx prisma migrate status` that there are no pending migrations.

- [ ] **Step 5: Rename the field at its two remaining call sites**

In `src/app/api/receipts/route.ts`, replace every occurrence of `lastSalesReceiptHash` with `lastInvoiceHash` — lines 266 (comment), 272 (`select`), 274 (`tenantForHash.lastSalesReceiptHash`), 279 (`select`), 282 (`tenantCounters.lastSalesReceiptHash`), and 418 (`data: { lastSalesReceiptHash: invoiceHash }`). No other logic in this file changes.

In `src/lib/tenant-deletion/build-archive.test.ts:11`, change `lastSalesReceiptHash: null` to `lastInvoiceHash: null`.

- [ ] **Step 6: Run the existing test suite to confirm the rename didn't break anything**

```bash
npx vitest run src/app/api/receipts src/lib/tenant-deletion
```

Expected: all existing tests pass unchanged — this task is a pure rename plus additive schema changes, no behavior differs yet.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/app/api/receipts/route.ts src/lib/tenant-deletion/build-archive.test.ts
git commit -m "Add credit note schema: CREDIT_NOTE type, RETURN movement, line self-relation, rename invoice-hash field"
```

---

### Task 2: Partial-credit line calculation

**Files:**
- Modify: `src/lib/receipts/calculate-totals.ts`
- Test: `src/lib/receipts/calculate-totals.test.ts`

**Interfaces:**
- Consumes: `calculateLine(input: LineInput): LineTotals` and `round2()` (both already in this file, unchanged).
- Produces: `calculateCreditNoteLine(input: CreditNoteLineInput): LineTotals` — used by Task 4's POST route.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/receipts/calculate-totals.test.ts`:

```ts
describe("calculateCreditNoteLine", () => {
  it("reproduces the original line's totals exactly when the full quantity is credited", () => {
    const result = calculateCreditNoteLine({
      unitPrice: 25,
      vatRate: 15,
      originalQuantity: 3,
      originalDiscount: 6,
      creditedQuantity: 3,
    });
    // Same math as calculateLine({ unitPrice: 25, quantity: 3, vatRate: 15, discount: 6 })
    expect(result).toEqual({ lineSubtotal: 69, lineVat: 10.35, lineTotal: 79.35 });
  });

  it("scales the discount proportionally for a partial credit", () => {
    // Original: 3 units, discount 1.00 total. Crediting 1 of the 3 units scales
    // the discount to round2(1.00 * 1/3) = 0.33.
    const result = calculateCreditNoteLine({
      unitPrice: 10,
      vatRate: 15,
      originalQuantity: 3,
      originalDiscount: 1,
      creditedQuantity: 1,
    });
    // calculateLine({ unitPrice: 10, quantity: 1, vatRate: 15, discount: 0.33 }):
    // rawSubtotal = 10, lineSubtotal = 9.67, lineVat = round2(9.67*0.15) = 1.45, lineTotal = 11.12
    expect(result).toEqual({ lineSubtotal: 9.67, lineVat: 1.45, lineTotal: 11.12 });
  });

  it("applies zero discount unchanged", () => {
    const result = calculateCreditNoteLine({
      unitPrice: 12,
      vatRate: 15,
      originalQuantity: 5,
      originalDiscount: 0,
      creditedQuantity: 2,
    });
    // calculateLine({ unitPrice: 12, quantity: 2, vatRate: 15, discount: 0 }):
    // lineSubtotal = 24, lineVat = 3.6, lineTotal = 27.6
    expect(result).toEqual({ lineSubtotal: 24, lineVat: 3.6, lineTotal: 27.6 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/lib/receipts/calculate-totals.test.ts
```

Expected: FAIL with `calculateCreditNoteLine is not defined` (or a TypeScript error, depending on how vitest surfaces it).

- [ ] **Step 3: Implement it**

Add to `src/lib/receipts/calculate-totals.ts`, after `calculateLineFromTotal`:

```ts
export interface CreditNoteLineInput {
  unitPrice: number;
  vatRate: number;
  originalQuantity: number;
  originalDiscount: number;
  creditedQuantity: number;
}

// A partial credit note line reuses the *original* line's unit price, VAT rate,
// and discount rate -- crediting the customer back exactly what they were
// actually charged per unit, rather than re-deriving pricing from a total
// (which would reintroduce the exact rounding gap calculateLineFromTotal exists
// to avoid). The discount, which was a flat per-line amount, is scaled by the
// fraction of the line being credited.
export function calculateCreditNoteLine(input: CreditNoteLineInput): LineTotals {
  const scaledDiscount =
    input.originalQuantity > 0
      ? round2(input.originalDiscount * (input.creditedQuantity / input.originalQuantity))
      : 0;
  return calculateLine({
    unitPrice: input.unitPrice,
    quantity: input.creditedQuantity,
    vatRate: input.vatRate,
    discount: scaledDiscount,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/receipts/calculate-totals.test.ts
```

Expected: PASS, all tests including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipts/calculate-totals.ts src/lib/receipts/calculate-totals.test.ts
git commit -m "Add calculateCreditNoteLine for proportional partial-credit VAT math"
```

---

### Task 3: Creditable-lines lookup — shared helper and GET route

**Files:**
- Create: `src/lib/receipts/creditable-lines.ts`
- Create: `src/app/api/receipts/[id]/creditable-lines/route.ts`
- Test: `src/app/api/receipts/[id]/creditable-lines/route.test.ts`

**Interfaces:**
- Consumes: `withTenant()` from `src/lib/db/tenant-context.ts` (unchanged), `Document.type`/`DocumentLine.creditedForLineId` from Task 1.
- Produces: `getCreditableLines(tenantId: string, documentId: string): Promise<CreditableLinesResult | null>` and its exported `CreditableLine`/`CreditableLinesResult` types — reused by Task 6 (the print-page button's eligibility check) and Task 7 (the picker page).

- [ ] **Step 1: Write the failing test**

Create `src/app/api/receipts/[id]/creditable-lines/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { GET } from "./route";

let tenantId: string;
let otherTenantId: string;
let userId: string;
let receiptId: string;
let quotationId: string;
let lineAId: string;
let lineBId: string;
let mockSession: { user: { tenantId: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function req(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/receipts/[id]/creditable-lines", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const tenant = await prisma.tenant.create({
      data: { legalName: "Creditable Lines Co", tradeNameEn: "Creditable Lines Shop", vatNumber: `30000000000${uniqueId.toString().slice(-4)}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `creditable-lines-test+${uniqueId}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, id: userId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });
    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Creditable Product", unitPrice: 10, quantity: 100 } as Prisma.ProductUncheckedCreateInput })
    );

    const saveResponse = await createReceipt(
      new Request("http://localhost/api/receipts", {
        method: "POST",
        body: JSON.stringify({
          customer: { name: "", vatId: "" },
          lines: [
            { productId: product.id, quantity: "3" },
            { productId: product.id, quantity: "5" },
          ],
        }),
      })
    );
    const saved = await saveResponse.json();
    receiptId = saved.id;
    lineAId = saved.lines[0].id;
    lineBId = saved.lines[1].id;

    // Simulate a previously-issued credit note crediting 1 of line A's 3 units,
    // without going through the real POST /api/credit-notes route (that route
    // doesn't exist until Task 4) -- just enough of a DocumentLine row to
    // exercise the aggregation this route computes.
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "CREDIT_NOTE",
          number: 1,
          customerId: saved.customerId,
          subtotal: 3.04,
          vatTotal: 0.46,
          grandTotal: 3.5,
          creditNoteOfDocumentId: receiptId,
          lines: {
            create: [
              {
                tenantId,
                productId: product.id,
                productName: "Creditable Product",
                quantity: 1,
                unitPrice: 10,
                discount: 0,
                vatRate: 15,
                lineSubtotal: 10,
                lineVat: 1.5,
                lineTotal: 11.5,
                creditedForLineId: lineAId,
              },
            ],
          },
        } as unknown as Prisma.DocumentUncheckedCreateInput,
      })
    );

    const quotation = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "QUOTATION",
          number: 1,
          customerId: saved.customerId,
          subtotal: 10,
          vatTotal: 1.5,
          grandTotal: 11.5,
        } as unknown as Prisma.DocumentUncheckedCreateInput,
      })
    );
    quotationId = quotation.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Co", tradeNameEn: "Other Shop", vatNumber: `30000000001${uniqueId.toString().slice(-4)}` },
    });
    otherTenantId = otherTenant.id;
  }, 30000);

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.documentLine.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  }, 30000);

  it("returns each line's original, credited, and remaining quantity", async () => {
    const response = await GET(new Request(`http://localhost/api/receipts/${receiptId}/creditable-lines`), req(receiptId));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.documentId).toBe(receiptId);
    const lineA = body.lines.find((l: { id: string }) => l.id === lineAId);
    const lineB = body.lines.find((l: { id: string }) => l.id === lineBId);
    expect(lineA).toMatchObject({ quantity: 3, creditedQuantity: 1, remainingQuantity: 2 });
    expect(lineB).toMatchObject({ quantity: 5, creditedQuantity: 0, remainingQuantity: 5 });
  });

  it("404s for a document belonging to another tenant", async () => {
    mockSession = { user: { tenantId: otherTenantId, id: userId } };
    const response = await GET(new Request(`http://localhost/api/receipts/${receiptId}/creditable-lines`), req(receiptId));
    expect(response.status).toBe(404);
    mockSession = { user: { tenantId, id: userId } };
  });

  it("404s for a quotation (not a sales receipt)", async () => {
    const response = await GET(new Request(`http://localhost/api/receipts/${quotationId}/creditable-lines`), req(quotationId));
    expect(response.status).toBe(404);
  });

  it("401s when unauthenticated", async () => {
    mockSession = null;
    const response = await GET(new Request(`http://localhost/api/receipts/${receiptId}/creditable-lines`), req(receiptId));
    expect(response.status).toBe(401);
    mockSession = { user: { tenantId, id: userId } };
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/api/receipts/[id]/creditable-lines/route.test.ts
```

Expected: FAIL — the module `./route` doesn't exist yet.

- [ ] **Step 3: Implement the shared helper**

Create `src/lib/receipts/creditable-lines.ts`:

```ts
import { withTenant } from "@/lib/db/tenant-context";

export interface CreditableLine {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
  creditedQuantity: number;
  remainingQuantity: number;
}

export interface CreditableLinesResult {
  documentId: string;
  documentNumber: number;
  lines: CreditableLine[];
}

// Remaining-creditable quantity is always computed here, never stored on the
// original line -- DocumentLine rows are immutable once written (see the
// Global Constraints in this plan), so "how much of this line is left to
// credit" is a derived value, summed fresh from whatever credit-note lines
// already point at it via creditedForLineId.
export async function getCreditableLines(tenantId: string, documentId: string): Promise<CreditableLinesResult | null> {
  return withTenant(tenantId, async (tx) => {
    const document = await tx.document.findFirst({
      where: { id: documentId, type: "SALES_RECEIPT" },
      include: { lines: true },
    });
    if (!document) return null;

    const lineIds = document.lines.map((line) => line.id);
    const creditedSums =
      lineIds.length > 0
        ? await tx.documentLine.groupBy({
            by: ["creditedForLineId"],
            where: { creditedForLineId: { in: lineIds } },
            _sum: { quantity: true },
          })
        : [];
    const creditedByLineId = new Map(
      creditedSums.map((row) => [row.creditedForLineId as string, Number(row._sum.quantity ?? 0)])
    );

    return {
      documentId: document.id,
      documentNumber: document.number,
      lines: document.lines.map((line) => {
        const quantity = Number(line.quantity);
        const creditedQuantity = creditedByLineId.get(line.id) ?? 0;
        return {
          id: line.id,
          productName: line.productName,
          quantity,
          unitPrice: Number(line.unitPrice),
          discount: Number(line.discount),
          vatRate: Number(line.vatRate),
          creditedQuantity,
          remainingQuantity: quantity - creditedQuantity,
        };
      }),
    };
  });
}
```

- [ ] **Step 4: Implement the route**

Create `src/app/api/receipts/[id]/creditable-lines/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { getCreditableLines } from "@/lib/receipts/creditable-lines";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const result = await getCreditableLines(tenantId, id);
  if (!result) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/app/api/receipts/[id]/creditable-lines/route.test.ts
```

Expected: PASS, all four tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/receipts/creditable-lines.ts src/app/api/receipts/[id]/creditable-lines
git commit -m "Add creditable-lines lookup: remaining-quantity-per-line for a receipt"
```

---

### Task 4: POST /api/credit-notes — the write path

**Files:**
- Create: `src/app/api/credit-notes/route.ts`
- Test: `src/app/api/credit-notes/route.test.ts`

**Interfaces:**
- Consumes: `calculateCreditNoteLine()` and `calculateDocumentTotals()` (Task 2), `computeInvoiceHash`/`GENESIS_HASH` from `src/lib/zatca/hash-chain.ts` (unchanged), `buildZatcaQrPayload()` from `src/lib/zatca/qr-payload.ts` (unchanged), `applyStockMovement()` from `src/lib/inventory/apply-stock-movement.ts` (unchanged, called with `type: "RETURN"`), `Tenant.nextCreditNoteNumber`/`lastInvoiceHash` and `DocumentLine.creditedForLineId` (Task 1).
- Produces: `POST /api/credit-notes` — the created `Document` (with `lines`) as JSON, 201. This is Task 7's redirect target's data source (Task 7 redirects to `/credit-notes/[id]/print` using the returned `id`).

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/credit-notes/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { POST } from "./route";

let tenantId: string;
let userId: string;
let productId: string;
let mockSession: { user: { tenantId: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/credit-notes", { method: "POST", body: JSON.stringify(body) });
}

async function seedReceipt(quantities: number[]) {
  const response = await createReceipt(
    new Request("http://localhost/api/receipts", {
      method: "POST",
      body: JSON.stringify({
        customer: { name: "", vatId: "" },
        lines: quantities.map((quantity) => ({ productId, quantity: String(quantity) })),
      }),
    })
  );
  return response.json();
}

describe("POST /api/credit-notes", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const tenant = await prisma.tenant.create({
      data: { legalName: "Credit Note Route Co", tradeNameEn: "Credit Note Route Shop", vatNumber: `30000000002${uniqueId.toString().slice(-4)}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `credit-note-route-test+${uniqueId}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, id: userId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });
    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Credit Note Product", unitPrice: 10, quantity: 1000 } as Prisma.ProductUncheckedCreateInput })
    );
    productId = product.id;
  }, 30000);

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.documentLine.deleteMany({ where: { tenantId } });
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  }, 30000);

  it(
    "fully credits a single-line receipt, restores stock, and chains the invoice hash",
    { timeout: 20000 },
    async () => {
      const receipt = await seedReceipt([2]);
      const productBefore = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));

      const response = await POST(
        postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 2 }] })
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.type).toBe("CREDIT_NOTE");
      expect(body.creditNoteOfDocumentId).toBe(receipt.id);
      expect(body.previousInvoiceHash).toBe(receipt.invoiceHash);
      expect(Number(body.grandTotal)).toBe(Number(receipt.grandTotal));

      const productAfter = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
      expect(Number(productAfter.quantity)).toBe(Number(productBefore.quantity) + 2);

      const movement = await withTenant(tenantId, (tx) =>
        tx.stockMovement.findFirst({ where: { documentId: body.id, type: "RETURN" } })
      );
      expect(movement).toBeTruthy();
      expect(Number(movement!.quantityDelta)).toBe(2);

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant.lastInvoiceHash).toBe(body.invoiceHash);
    }
  );

  it("partially credits one line of a multi-line receipt", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([3, 5]);
    const response = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines).toHaveLength(1);
    expect(Number(body.lines[0].quantity)).toBe(1);
    expect(body.lines[0].creditedForLineId).toBe(receipt.lines[0].id);
  });

  it("rejects crediting more than what remains on a line", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([2]);
    const response = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 3 }] })
    );
    expect(response.status).toBe(400);
  });

  it(
    "under two truly concurrent requests crediting the same line's last unit, exactly one succeeds",
    { timeout: 20000 },
    async () => {
      const receipt = await seedReceipt([1]);
      const [first, second] = await Promise.all([
        POST(postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })),
        POST(postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })),
      ]);
      const statuses = [first.status, second.status].sort();
      // The tenant-row lock (taken via the nextCreditNoteNumber increment, before
      // either transaction re-reads how much of the line is already credited)
      // serializes these two transactions -- whichever commits first sees the
      // line as untouched and succeeds; the other re-reads after that commit,
      // sees the line fully credited, and is rejected. Both succeeding would
      // mean the line was credited twice for a receipt that only had 1 unit.
      expect(statuses).toEqual([201, 400]);
    }
  );

  it("rejects a second credit note that would exceed what's left after a prior one", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([2]);
    const first = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })
    );
    expect(first.status).toBe(201);
    const second = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 2 }] })
    );
    expect(second.status).toBe(400);
  });

  it("rejects crediting a credit note (not a sales receipt)", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([2]);
    const creditNoteResponse = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })
    );
    const creditNote = await creditNoteResponse.json();
    const secondCreditNote = await withTenant(tenantId, (tx) =>
      tx.document.findFirstOrThrow({ where: { id: creditNote.id }, include: { lines: true } })
    );
    const response = await POST(
      postRequest({
        originalDocumentId: secondCreditNote.id,
        lines: [{ originalLineId: secondCreditNote.lines[0].id, quantity: 1 }],
      })
    );
    expect(response.status).toBe(404);
  });

  it("rejects crediting a quotation", { timeout: 20000 }, async () => {
    const customer = await withTenant(tenantId, (tx) => tx.customer.findFirstOrThrow({ where: { isWalkIn: true } }));
    const quotation = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "QUOTATION",
          number: 999,
          customerId: customer.id,
          subtotal: 10,
          vatTotal: 1.5,
          grandTotal: 11.5,
          lines: {
            create: [
              {
                tenantId,
                productId,
                productName: "Credit Note Product",
                quantity: 1,
                unitPrice: 10,
                discount: 0,
                vatRate: 15,
                lineSubtotal: 10,
                lineVat: 1.5,
                lineTotal: 11.5,
              },
            ],
          },
        } as unknown as Prisma.DocumentUncheckedCreateInput,
        include: { lines: true },
      })
    );
    const response = await POST(
      postRequest({ originalDocumentId: quotation.id, lines: [{ originalLineId: quotation.lines[0].id, quantity: 1 }] })
    );
    expect(response.status).toBe(404);
  });

  it("rejects an empty lines array", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([2]);
    const response = await POST(postRequest({ originalDocumentId: receipt.id, lines: [] }));
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/api/credit-notes/route.test.ts
```

Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/credit-notes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { calculateCreditNoteLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import { computeInvoiceHash, GENESIS_HASH } from "@/lib/zatca/hash-chain";
import { buildZatcaQrPayload } from "@/lib/zatca/qr-payload";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { applyStockMovement } from "@/lib/inventory/apply-stock-movement";

class CreditNoteError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RawCreditLine {
  originalLineId?: unknown;
  quantity?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const userId = session.user.id;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const body = await request.json();

  const originalDocumentId = typeof body.originalDocumentId === "string" ? body.originalDocumentId : null;
  if (!originalDocumentId) {
    return NextResponse.json({ error: "originalDocumentId is required" }, { status: 400 });
  }

  const rawLines: RawCreditLine[] = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "Select at least one item to credit" }, { status: 400 });
  }

  const parsedLines: { originalLineId: string; quantity: number }[] = [];
  for (const line of rawLines) {
    const quantity = Number(line.quantity);
    if (typeof line.originalLineId !== "string" || !Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Each credited item must have a positive quantity" }, { status: 400 });
    }
    parsedLines.push({ originalLineId: line.originalLineId, quantity });
  }

  const trimmedNotes = typeof body.notes === "string" ? body.notes.trim() : "";
  const notes = trimmedNotes || null;

  try {
    const created = await prisma.$transaction(async (txn) => {
      const original = await txn.document.findFirst({
        where: { id: originalDocumentId, tenantId, type: "SALES_RECEIPT" },
        include: { lines: true },
      });
      if (!original) {
        throw new CreditNoteError("Receipt not found", 404);
      }

      const originalLinesById = new Map(original.lines.map((line) => [line.id, line]));
      for (const line of parsedLines) {
        if (!originalLinesById.has(line.originalLineId)) {
          throw new CreditNoteError("One or more items do not belong to this receipt", 400);
        }
      }

      // Row-locks this tenant for the rest of the transaction, same idiom as
      // receipts/route.ts's own number-consuming update -- this is what makes
      // the remaining-quantity check below race-safe: two concurrent credit
      // notes against the same receipt can no longer both read the same
      // "already credited" sum and both approve an over-credit, because the
      // second transaction blocks here until the first commits.
      const tenantCounters = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextCreditNoteNumber: { increment: 1 } },
        select: { nextCreditNoteNumber: true, lastInvoiceHash: true },
      });
      const number = tenantCounters.nextCreditNoteNumber - 1;
      const previousInvoiceHash = tenantCounters.lastInvoiceHash ?? GENESIS_HASH;

      const originalLineIds = original.lines.map((line) => line.id);
      const creditedSums = await txn.documentLine.groupBy({
        by: ["creditedForLineId"],
        where: { creditedForLineId: { in: originalLineIds } },
        _sum: { quantity: true },
      });
      const creditedByLineId = new Map(
        creditedSums.map((row) => [row.creditedForLineId as string, Number(row._sum.quantity ?? 0)])
      );

      const resolvedLines: {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        discount: number;
        vatRate: number;
        lineSubtotal: number;
        lineVat: number;
        lineTotal: number;
        creditedForLineId: string;
      }[] = [];

      for (const line of parsedLines) {
        const originalLine = originalLinesById.get(line.originalLineId)!;
        const alreadyCredited = creditedByLineId.get(line.originalLineId) ?? 0;
        const originalQuantity = Number(originalLine.quantity);
        const remaining = originalQuantity - alreadyCredited;
        if (line.quantity > remaining) {
          throw new CreditNoteError("Quantity exceeds what's left to credit on this item", 400);
        }

        const { lineSubtotal, lineVat, lineTotal } = calculateCreditNoteLine({
          unitPrice: Number(originalLine.unitPrice),
          vatRate: Number(originalLine.vatRate),
          originalQuantity,
          originalDiscount: Number(originalLine.discount),
          creditedQuantity: line.quantity,
        });

        resolvedLines.push({
          productId: originalLine.productId,
          productName: originalLine.productName,
          quantity: line.quantity,
          unitPrice: Number(originalLine.unitPrice),
          discount: 0,
          vatRate: Number(originalLine.vatRate),
          lineSubtotal,
          lineVat,
          lineTotal,
          creditedForLineId: originalLine.id,
        });
      }

      const { subtotal, vatTotal, grandTotal } = calculateDocumentTotals(resolvedLines);

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

      const document = await txn.document.create({
        data: {
          tenantId,
          type: "CREDIT_NOTE",
          number,
          customerId: original.customerId,
          creditNoteOfDocumentId: original.id,
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
              discount: line.discount,
              vatRate: line.vatRate,
              lineSubtotal: line.lineSubtotal,
              lineVat: line.lineVat,
              lineTotal: line.lineTotal,
              creditedForLineId: line.creditedForLineId,
            })),
          },
        } as Prisma.DocumentUncheckedCreateInput,
        include: { lines: true },
      });

      for (const line of resolvedLines) {
        await applyStockMovement(txn, {
          tenantId,
          productId: line.productId,
          type: "RETURN",
          quantityDelta: line.quantity,
          createdByUserId: userId,
          documentId: document.id,
        });
      }

      await txn.tenant.update({
        where: { id: tenantId },
        data: { lastInvoiceHash: invoiceHash },
      });

      return document;
    }, { timeout: 15000, maxWait: 5000 });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof CreditNoteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/api/credit-notes/route.test.ts
```

Expected: PASS, all eight tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/credit-notes
git commit -m "Add POST /api/credit-notes: partial/full credit, stock restore, invoice-hash chain"
```

---

### Task 5: Credit note print and PDF output

**Files:**
- Modify: `src/lib/receipts/get-print-data.ts`
- Modify: `src/app/api/receipts/[id]/print-data/route.ts`
- Modify: `src/app/api/receipts/[id]/pdf/route.tsx`
- Modify: `src/components/receipts/receipt-print-thermal.tsx:61`
- Modify: `src/components/receipts/receipt-print-a4.tsx:52-54`
- Modify: `src/lib/receipts/receipt-pdf.tsx:127`
- Modify: `src/lib/receipts/receipt-pdf-a4.tsx:40-42`
- Create: `src/app/api/credit-notes/[id]/print-data/route.ts`
- Create: `src/app/api/credit-notes/[id]/pdf/route.tsx`
- Create: `src/app/(app)/credit-notes/[id]/print/page.tsx`
- Test: `src/lib/receipts/get-print-data.test.ts` (extend existing file)
- Test: `src/app/api/credit-notes/[id]/print-data/route.test.ts`

**Interfaces:**
- Consumes: `DocumentType.CREDIT_NOTE` (Task 1).
- Produces: `getDocumentPrintData(tenantId: string, id: string, type: "SALES_RECEIPT" | "CREDIT_NOTE"): Promise<DocumentPrintData | null>` (renamed from `getReceiptPrintData`) — Task 6's print-page button-eligibility logic does not use this, but Task 7's redirect target (`/credit-notes/[id]/print`) is this task's new page.

- [ ] **Step 1: Generalize `getDocumentPrintData`**

In `src/lib/receipts/get-print-data.ts`, rename the exported interface and function, and take the document type as a parameter:

```ts
import QRCode from "qrcode";
import type { Customer, DocumentLine, DocumentType, Tenant, Document as PrismaDocument } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export interface DocumentPrintData {
  printFormat: "THERMAL" | "A4";
  tenant: Tenant;
  document: PrismaDocument & { customer: Customer; lines: DocumentLine[] };
  qrImageDataUrl: string | null;
}

export async function getDocumentPrintData(
  tenantId: string,
  id: string,
  type: DocumentType
): Promise<DocumentPrintData | null> {
  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) return null;

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const qrImageDataUrl = document.qrCode ? await QRCode.toDataURL(document.qrCode) : null;

  return { printFormat: settings.printFormat, tenant, document, qrImageDataUrl };
}
```

- [ ] **Step 2: Update the three existing call sites**

In `src/app/api/receipts/[id]/print-data/route.ts`, change the import and call:

```ts
import { getDocumentPrintData } from "@/lib/receipts/get-print-data";
// ...
const data = await getDocumentPrintData(tenantId, id, "SALES_RECEIPT");
```

In `src/app/api/receipts/[id]/pdf/route.tsx`, same change:

```ts
import { getDocumentPrintData } from "@/lib/receipts/get-print-data";
// ...
const data = await getDocumentPrintData(tenantId, id, "SALES_RECEIPT");
```

In `src/app/(app)/receipts/[id]/print/page.tsx`, same change (this file is also touched again in Task 6 — that task's diff starts from this version):

```ts
import { getDocumentPrintData } from "@/lib/receipts/get-print-data";
// ...
const data = await getDocumentPrintData(tenantId, id, "SALES_RECEIPT");
```

- [ ] **Step 3: Update `get-print-data.test.ts`**

Read the existing `src/lib/receipts/get-print-data.test.ts` first to match its setup style. Update every call from `getReceiptPrintData(tenantId, id)` to `getDocumentPrintData(tenantId, id, "SALES_RECEIPT")`, and add one new test:

```ts
it("returns null when a SALES_RECEIPT id is looked up as a CREDIT_NOTE", async () => {
  const result = await getDocumentPrintData(tenantId, receiptId, "CREDIT_NOTE");
  expect(result).toBeNull();
});
```

(Use whatever the file's existing seeded receipt variable is named in place of `receiptId` above.)

- [ ] **Step 4: Add the credit-note-typed label to all four render components**

In `src/components/receipts/receipt-print-thermal.tsx`, replace line 61:

```tsx
        <div>
          {document.type === "CREDIT_NOTE"
            ? `إشعار دائن / Credit Note #${document.number}`
            : `فاتورة ضريبية مبسطة / Simplified Tax Invoice #${document.number}`}
        </div>
```

In `src/lib/receipts/receipt-pdf.tsx`, replace line 127:

```tsx
          <Text>
            {document.type === "CREDIT_NOTE"
              ? `إشعار دائن / Credit Note #${document.number}`
              : `فاتورة ضريبية مبسطة / Simplified Tax Invoice #${document.number}`}
          </Text>
```

In `src/components/receipts/receipt-print-a4.tsx`, replace lines 52-54:

```tsx
              docTitleEn={document.type === "CREDIT_NOTE" ? "Credit Note" : "Simplified Tax Invoice"}
              docTitleAr={document.type === "CREDIT_NOTE" ? "إشعار دائن" : "فاتورة ضريبية مبسطة"}
              docNumberLabel={document.type === "CREDIT_NOTE" ? "Credit Note" : "Invoice"}
```

In `src/lib/receipts/receipt-pdf-a4.tsx`, replace lines 40-42:

```tsx
              docTitleEn={document.type === "CREDIT_NOTE" ? "Credit Note" : "Simplified Tax Invoice"}
              docTitleAr={document.type === "CREDIT_NOTE" ? "إشعار دائن" : "فاتورة ضريبية مبسطة"}
              docNumberLabel={document.type === "CREDIT_NOTE" ? "Credit Note" : "Invoice"}
```

- [ ] **Step 5: Add the two new credit-note routes**

Create `src/app/api/credit-notes/[id]/print-data/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { getDocumentPrintData } from "@/lib/receipts/get-print-data";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const data = await getDocumentPrintData(tenantId, id, "CREDIT_NOTE");
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    printFormat: data.printFormat,
    tenant: {
      tradeNameEn: data.tenant.tradeNameEn,
      tradeNameAr: data.tenant.tradeNameAr,
      legalName: data.tenant.legalName,
      vatNumber: data.tenant.vatNumber,
      crNumber: data.tenant.crNumber,
      phone: data.tenant.phone,
      address: data.tenant.address,
    },
    document: {
      number: data.document.number,
      createdAt: data.document.createdAt,
      subtotal: data.document.subtotal,
      vatTotal: data.document.vatTotal,
      grandTotal: data.document.grandTotal,
      notes: data.document.notes,
      customer: {
        name: data.document.customer.name,
        vatId: data.document.customer.vatId,
        crNumber: data.document.customer.crNumber,
        phone: data.document.customer.phone,
        address: data.document.customer.address,
      },
      lines: data.document.lines.map((line) => ({
        id: line.id,
        productName: line.productName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        lineVat: line.lineVat,
        lineTotal: line.lineTotal,
      })),
    },
    qrImageDataUrl: data.qrImageDataUrl,
  });
}
```

Create `src/app/api/credit-notes/[id]/pdf/route.tsx`:

```tsx
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/lib/auth/config";
import { getDocumentPrintData } from "@/lib/receipts/get-print-data";
import { ReceiptPdfDocument } from "@/lib/receipts/receipt-pdf";
import { ReceiptPdfA4Document } from "@/lib/receipts/receipt-pdf-a4";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const data = await getDocumentPrintData(tenantId, id, "CREDIT_NOTE");
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await renderToBuffer(
    data.printFormat === "A4" ? (
      <ReceiptPdfA4Document tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />
    ) : (
      <ReceiptPdfDocument tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />
    )
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="credit-note-${data.document.number}.pdf"`,
    },
  });
}
```

Create `src/app/(app)/credit-notes/[id]/print/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getDocumentPrintData } from "@/lib/receipts/get-print-data";
import { ReceiptPrintThermal } from "@/components/receipts/receipt-print-thermal";
import { ReceiptPrintA4 } from "@/components/receipts/receipt-print-a4";

export default async function CreditNotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const data = await getDocumentPrintData(tenantId, id, "CREDIT_NOTE");
  if (!data) {
    notFound();
  }

  if (data.printFormat === "A4") {
    return <ReceiptPrintA4 tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />;
  }
  return <ReceiptPrintThermal tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />;
}
```

- [ ] **Step 6: Write the new route's test**

Create `src/app/api/credit-notes/[id]/print-data/route.test.ts`, following the structure of `src/app/api/receipts/[id]/pdf/route.test.ts` (real tenant/user/product/customer setup, `createReceipt` to seed a receipt, then `POST` from `@/app/api/credit-notes/route` to create a credit note against it):

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { POST as createCreditNote } from "@/app/api/credit-notes/route";
import { GET } from "./route";

let tenantId: string;
let userId: string;
let creditNoteId: string;
let mockSession: { user: { tenantId: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("GET /api/credit-notes/[id]/print-data", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const tenant = await prisma.tenant.create({
      data: { legalName: "Credit Note Print Co", tradeNameEn: "Credit Note Print Shop", tradeNameAr: "متجر إشعار الدائن", vatNumber: `30000000003${uniqueId.toString().slice(-4)}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `credit-note-print-test+${uniqueId}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, id: userId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });
    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Print Data Product", unitPrice: 10, quantity: 20 } as Prisma.ProductUncheckedCreateInput })
    );

    const receiptResponse = await createReceipt(
      new Request("http://localhost/api/receipts", {
        method: "POST",
        body: JSON.stringify({ customer: { name: "", vatId: "" }, lines: [{ productId: product.id, quantity: "2" }] }),
      })
    );
    const receipt = await receiptResponse.json();

    const creditNoteResponse = await createCreditNote(
      new Request("http://localhost/api/credit-notes", {
        method: "POST",
        body: JSON.stringify({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 2 }] }),
      })
    );
    const creditNote = await creditNoteResponse.json();
    creditNoteId = creditNote.id;
  }, 30000);

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.documentLine.deleteMany({ where: { tenantId } });
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  }, 30000);

  it("returns the credit note's print data", async () => {
    const response = await GET(
      new Request(`http://localhost/api/credit-notes/${creditNoteId}/print-data`),
      { params: Promise.resolve({ id: creditNoteId }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.document.number).toBe(1);
    expect(body.document.lines).toHaveLength(1);
  });

  it("404s when the id is a receipt, not a credit note", async () => {
    const receipt = await withTenant(tenantId, (tx) => tx.document.findFirstOrThrow({ where: { type: "SALES_RECEIPT" } }));
    const response = await GET(
      new Request(`http://localhost/api/credit-notes/${receipt.id}/print-data`),
      { params: Promise.resolve({ id: receipt.id }) }
    );
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 7: Run every test touched by this task**

```bash
npx vitest run src/lib/receipts/get-print-data.test.ts src/app/api/receipts/[id]/print-data src/app/api/receipts/[id]/pdf src/app/api/credit-notes
```

Expected: PASS across all of them.

- [ ] **Step 8: Commit**

```bash
git add src/lib/receipts/get-print-data.ts src/app/api/receipts/[id]/print-data/route.ts src/app/api/receipts/[id]/pdf/route.tsx src/components/receipts/receipt-print-thermal.tsx src/components/receipts/receipt-print-a4.tsx src/lib/receipts/receipt-pdf.tsx src/lib/receipts/receipt-pdf-a4.tsx src/app/api/credit-notes/[id] "src/app/(app)/credit-notes" src/lib/receipts/get-print-data.test.ts
git commit -m "Generalize print/PDF pipeline for credit notes, add credit-note print routes"
```

---

### Task 6: "Issue Credit Note" button on the receipt print page

**Files:**
- Modify: `src/app/(app)/receipts/[id]/print/page.tsx`
- Modify: `src/components/receipts/receipt-print-thermal.tsx`
- Modify: `src/components/receipts/receipt-print-a4.tsx`
- Create: `src/components/receipts/issue-credit-note-button.tsx`
- Modify: `src/lib/i18n/dictionaries/dictionary.types.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`
- Modify: `src/lib/i18n/dictionaries/ar.ts`

**Interfaces:**
- Consumes: `getCreditableLines()` (Task 3).
- Produces: a working `<Link href="/receipts/[id]/credit-note">` — Task 7 creates the page it points to; until Task 7 lands, this link 404s, which is fine mid-plan (this task's own test only asserts the button's presence/absence, not the destination page).

- [ ] **Step 1: Add the dictionary key**

In `src/lib/i18n/dictionaries/dictionary.types.ts`, add one field to the existing `printChrome` block:

```ts
  printChrome: {
    print: string;
    receiptTitle: string;
    quotationTitle: string;
    issueCreditNote: string;
  };
```

In `src/lib/i18n/dictionaries/en.ts`, find the `printChrome` object and add:

```ts
    issueCreditNote: "Issue Credit Note",
```

In `src/lib/i18n/dictionaries/ar.ts`, find the `printChrome` object and add:

```ts
    issueCreditNote: "إصدار إشعار دائن",
```

- [ ] **Step 2: Run the dictionary parity test to confirm both locales match**

```bash
npx vitest run src/lib/i18n/dictionaries/dictionary-parity.test.ts
```

Expected: PASS.

- [ ] **Step 3: Create the button component**

Create `src/components/receipts/issue-credit-note-button.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/language-provider";

export function IssueCreditNoteButton({ receiptId }: { receiptId: string }) {
  const { dict } = useLocale();
  return (
    <Button asChild variant="outline" className="mx-auto mt-2 block w-fit print:hidden">
      <Link href={`/receipts/${receiptId}/credit-note`}>{dict.printChrome.issueCreditNote}</Link>
    </Button>
  );
}
```

- [ ] **Step 4: Wire it into the two print-render components**

In `src/components/receipts/receipt-print-thermal.tsx`, add the import and render it next to `PrintButton`:

```tsx
import { PrintButton } from "./print-button";
import { IssueCreditNoteButton } from "./issue-credit-note-button";
```

Add a new prop and use it right after the existing `{showPrintButton && <PrintButton />}` line:

```tsx
export function ReceiptPrintThermal({
  tenant,
  document,
  qrImageDataUrl,
  showPrintButton = true,
  hasRemainingCreditableLines = false,
}: {
  tenant: Tenant;
  document: ReceiptDocument;
  qrImageDataUrl: string | null;
  showPrintButton?: boolean;
  hasRemainingCreditableLines?: boolean;
}) {
```

```tsx
      {showPrintButton && <PrintButton />}
      {document.type === "SALES_RECEIPT" && hasRemainingCreditableLines && (
        <IssueCreditNoteButton receiptId={document.id} />
      )}
```

Make the identical change in `src/components/receipts/receipt-print-a4.tsx`: import `IssueCreditNoteButton`, add the same `hasRemainingCreditableLines?: boolean` prop to its props type (default `false`), and render `{document.type === "SALES_RECEIPT" && hasRemainingCreditableLines && <IssueCreditNoteButton receiptId={document.id} />}` right after its existing `{showPrintButton && <PrintButton />}` line.

- [ ] **Step 5: Compute eligibility on the print page**

Replace `src/app/(app)/receipts/[id]/print/page.tsx` (which Task 5 already updated to call `getDocumentPrintData`) with:

```tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getDocumentPrintData } from "@/lib/receipts/get-print-data";
import { getCreditableLines } from "@/lib/receipts/creditable-lines";
import { ReceiptPrintThermal } from "@/components/receipts/receipt-print-thermal";
import { ReceiptPrintA4 } from "@/components/receipts/receipt-print-a4";

export default async function ReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const data = await getDocumentPrintData(tenantId, id, "SALES_RECEIPT");
  if (!data) {
    notFound();
  }

  const creditable = await getCreditableLines(tenantId, id);
  const hasRemainingCreditableLines = Boolean(creditable?.lines.some((line) => line.remainingQuantity > 0));

  if (data.printFormat === "A4") {
    return (
      <ReceiptPrintA4
        tenant={data.tenant}
        document={data.document}
        qrImageDataUrl={data.qrImageDataUrl}
        hasRemainingCreditableLines={hasRemainingCreditableLines}
      />
    );
  }
  return (
    <ReceiptPrintThermal
      tenant={data.tenant}
      document={data.document}
      qrImageDataUrl={data.qrImageDataUrl}
      hasRemainingCreditableLines={hasRemainingCreditableLines}
    />
  );
}
```

- [ ] **Step 6: Manually verify with the dev server**

Start the dev server, sign in, create a receipt, open its print page, and confirm the "Issue Credit Note" button renders below the Print button. This task deliberately has no automated route test of its own (the print page is a thin server component wiring together two already-tested functions); this is the check that the wiring is correct.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/receipts/[id]/print/page.tsx" src/components/receipts/receipt-print-thermal.tsx src/components/receipts/receipt-print-a4.tsx src/components/receipts/issue-credit-note-button.tsx src/lib/i18n/dictionaries
git commit -m "Add Issue Credit Note button to the receipt print page"
```

---

### Task 7: Credit note issuance page

**Files:**
- Create: `src/app/(app)/receipts/[id]/credit-note/page.tsx`
- Create: `src/components/receipts/credit-note-form.tsx`
- Modify: `src/lib/i18n/dictionaries/dictionary.types.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`
- Modify: `src/lib/i18n/dictionaries/ar.ts`

**Interfaces:**
- Consumes: `getCreditableLines()` and its `CreditableLine`/`CreditableLinesResult` types (Task 3), `calculateCreditNoteLine()`/`calculateDocumentTotals()` (Task 2), `POST /api/credit-notes` (Task 4), the redirect target `/credit-notes/[id]/print` (Task 5).
- Produces: the page at `/receipts/[id]/credit-note` that Task 6's button links to.

- [ ] **Step 1: Add the dictionary section**

In `src/lib/i18n/dictionaries/dictionary.types.ts`, add a new top-level section (alongside `receiptHistory`/`quotationHistory`):

```ts
  creditNote: {
    pageTitleWithNumber: (number: number) => string;
    headers: {
      product: string;
      originalQty: string;
      alreadyCredited: string;
      remaining: string;
      creditQty: string;
    };
    noRemainingLines: string;
    addAtLeastOneItem: string;
    quantityExceedsRemaining: string;
    submit: string;
  };
```

In `src/lib/i18n/dictionaries/en.ts`, add the matching object (near `receiptHistory`/`quotationHistory`):

```ts
  creditNote: {
    pageTitleWithNumber: (number: number) => `Credit Note for Receipt #${number}`,
    headers: {
      product: "Product",
      originalQty: "Original Qty",
      alreadyCredited: "Already Credited",
      remaining: "Remaining",
      creditQty: "Credit Qty",
    },
    noRemainingLines: "Nothing left to credit on this receipt.",
    addAtLeastOneItem: "Enter a quantity for at least one item.",
    quantityExceedsRemaining: "Quantity exceeds what's remaining.",
    submit: "Issue Credit Note",
  },
```

In `src/lib/i18n/dictionaries/ar.ts`, add the matching object:

```ts
  creditNote: {
    pageTitleWithNumber: (number: number) => `إشعار دائن للفاتورة رقم ${number}`,
    headers: {
      product: "المنتج",
      originalQty: "الكمية الأصلية",
      alreadyCredited: "تم إرجاعه سابقًا",
      remaining: "المتبقي",
      creditQty: "الكمية المرتجعة",
    },
    noRemainingLines: "لا توجد عناصر متاحة للإرجاع في هذه الفاتورة.",
    addAtLeastOneItem: "أدخل كمية لعنصر واحد على الأقل.",
    quantityExceedsRemaining: "الكمية تتجاوز المتبقي.",
    submit: "إصدار إشعار الدائن",
  },
```

- [ ] **Step 2: Run the dictionary parity test**

```bash
npx vitest run src/lib/i18n/dictionaries/dictionary-parity.test.ts
```

Expected: PASS.

- [ ] **Step 3: Create the server page**

Create `src/app/(app)/receipts/[id]/credit-note/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getCreditableLines } from "@/lib/receipts/creditable-lines";
import { CreditNoteForm } from "@/components/receipts/credit-note-form";

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const creditable = await getCreditableLines(tenantId, id);
  if (!creditable) {
    notFound();
  }

  return (
    <CreditNoteForm
      originalDocumentId={creditable.documentId}
      documentNumber={creditable.documentNumber}
      lines={creditable.lines}
    />
  );
}
```

- [ ] **Step 4: Create the client form**

Create `src/components/receipts/credit-note-form.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/language-provider";
import { calculateCreditNoteLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import type { CreditableLine } from "@/lib/receipts/creditable-lines";

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

interface CreditNoteFormProps {
  originalDocumentId: string;
  documentNumber: number;
  lines: CreditableLine[];
}

export function CreditNoteForm({ originalDocumentId, documentNumber, lines }: CreditNoteFormProps) {
  const { dict } = useLocale();
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const creditableLines = lines.filter((line) => line.remainingQuantity > 0);

  const selectedLines = useMemo(() => {
    return creditableLines
      .map((line) => {
        const raw = quantities[line.id];
        const quantity = raw === undefined || raw === "" ? 0 : Number(raw);
        return { line, quantity };
      })
      .filter(({ quantity }) => Number.isFinite(quantity) && quantity > 0);
  }, [creditableLines, quantities]);

  const totals = useMemo(() => {
    const computed = selectedLines.map(({ line, quantity }) =>
      calculateCreditNoteLine({
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        originalQuantity: line.quantity,
        originalDiscount: line.discount,
        creditedQuantity: quantity,
      })
    );
    return calculateDocumentTotals(computed);
  }, [selectedLines]);

  function handleQuantityChange(lineId: string, value: string) {
    setQuantities((prev) => ({ ...prev, [lineId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (selectedLines.length === 0) {
      setError(dict.creditNote.addAtLeastOneItem);
      return;
    }
    for (const { line, quantity } of selectedLines) {
      if (quantity > line.remainingQuantity) {
        setError(dict.creditNote.quantityExceedsRemaining);
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch("/api/credit-notes", {
        method: "POST",
        body: JSON.stringify({
          originalDocumentId,
          lines: selectedLines.map(({ line, quantity }) => ({ originalLineId: line.id, quantity })),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      router.push(`/credit-notes/${body.id}/print`);
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  if (creditableLines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <p className="text-sm text-body">{dict.creditNote.noRemainingLines}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="mb-4 text-lg font-bold text-heading">{dict.creditNote.pageTitleWithNumber(documentNumber)}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        {/* Desktop: table. Matches the established hidden md:block / md:hidden
            table-vs-card-list split used by Customers/Products/Inventory. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-muted-fg">
                <th className="py-1.5">{dict.creditNote.headers.product}</th>
                <th className="py-1.5 text-right">{dict.creditNote.headers.originalQty}</th>
                <th className="py-1.5 text-right">{dict.creditNote.headers.alreadyCredited}</th>
                <th className="py-1.5 text-right">{dict.creditNote.headers.remaining}</th>
                <th className="py-1.5 text-right">{dict.creditNote.headers.creditQty}</th>
              </tr>
            </thead>
            <tbody>
              {creditableLines.map((line) => (
                <tr key={line.id} className="border-b border-border-subtle">
                  <td className="py-1.5">{line.productName}</td>
                  <td className="py-1.5 text-right">{line.quantity}</td>
                  <td className="py-1.5 text-right">{line.creditedQuantity}</td>
                  <td className="py-1.5 text-right">{line.remainingQuantity}</td>
                  <td className="py-1.5 text-right">
                    <Input
                      type="number"
                      min={0}
                      max={line.remainingQuantity}
                      step="0.001"
                      value={quantities[line.id] ?? ""}
                      onChange={(e) => handleQuantityChange(line.id, e.target.value)}
                      className="ms-auto w-24 text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: card list, same breakpoint the table above hides at. */}
        <div className="flex flex-col gap-2 md:hidden">
          {creditableLines.map((line) => (
            <div key={line.id} className="rounded-lg border border-border-subtle p-3 text-sm">
              <div className="mb-2 font-medium text-heading">{line.productName}</div>
              <div className="mb-2 grid grid-cols-3 gap-2 text-xs text-muted-fg">
                <span>
                  {dict.creditNote.headers.originalQty}: <b className="text-body">{line.quantity}</b>
                </span>
                <span>
                  {dict.creditNote.headers.alreadyCredited}: <b className="text-body">{line.creditedQuantity}</b>
                </span>
                <span>
                  {dict.creditNote.headers.remaining}: <b className="text-body">{line.remainingQuantity}</b>
                </span>
              </div>
              <Label className={LABEL_CLASS}>{dict.creditNote.headers.creditQty}</Label>
              <Input
                type="number"
                min={0}
                max={line.remainingQuantity}
                step="0.001"
                value={quantities[line.id] ?? ""}
                onChange={(e) => handleQuantityChange(line.id, e.target.value)}
                className="w-full"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border-subtle bg-bg-app px-3 py-2.5 text-xs text-body">
          <div className="flex justify-between">
            <span>
              <Label className={LABEL_CLASS}>{dict.documentForm.totals.subtotal}</Label>
            </span>
            <span>{totals.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>
              <Label className={LABEL_CLASS}>{dict.documentForm.totals.totalVat}</Label>
            </span>
            <span>{totals.vatTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-heading">
            <span>{dict.documentForm.totals.grandTotal}</span>
            <span>{totals.grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? dict.common.savingEllipsis : dict.creditNote.submit}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Manually verify end-to-end with the dev server**

Start the dev server, sign in, create a receipt with at least two lines, open its print page, click "Issue Credit Note," enter a partial quantity on one line, submit, and confirm it redirects to `/credit-notes/[id]/print` showing the correct totals and a QR code. Reopen the original receipt's print page and confirm the remaining-quantity numbers reflect the credit just issued (crediting the same line again should now cap at the reduced remaining amount).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/receipts/[id]/credit-note" src/components/receipts/credit-note-form.tsx src/lib/i18n/dictionaries
git commit -m "Add credit note issuance page: line/quantity picker, live totals, submit"
```

---

## Final check

After Task 7, run the full suite once to confirm nothing elsewhere regressed:

```bash
npx vitest run
```

Then follow `superpowers:finishing-a-development-branch` to integrate the work.
