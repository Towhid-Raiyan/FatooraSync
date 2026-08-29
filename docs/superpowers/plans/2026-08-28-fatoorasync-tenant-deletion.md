# FatooraSync Tenant Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the CTO permanently delete a churned client from the admin panel, safely — every table under that tenant is exported to a downloadable archive and verified before anything is removed from Postgres, and a small permanent record (name, dates, a link to the archive) survives the deletion so the agency never loses the ability to say "yes, we had that client."

**Architecture:** A strict, ordered server-side flow (gather → build archive → upload to Vercel Blob → verify → write tombstone → delete tenant) behind one API route, reusing this app's existing PDF-rendering components so the archived receipts/quotations look exactly like the ones the app already generates. Deletion itself becomes possible via `onDelete: Cascade` added to every tenant-scoped relation — today, deleting a `Tenant` row fails outright.

**Tech Stack:** Next.js App Router, Prisma/Postgres, `@vercel/blob` (new dependency), `jszip` (new dependency), `@react-pdf/renderer` (already used, reused here for bulk PDF generation).

**Spec:** [docs/superpowers/specs/2026-08-28-fatoorasync-tenant-deletion-design.md](../specs/2026-08-28-fatoorasync-tenant-deletion-design.md)

## Global Constraints

- Restricted to `AgencyStaffRole.CTO` — every route this plan adds or touches must call the existing `assertCtoRole(session.user.role)` helper (`src/lib/admin-auth/require-cto.ts`), matching the pattern already used by the tenant create/update routes.
- The delete flow is strictly ordered and must abort cleanly at any failure point before the tenant is actually deleted — see spec §4.2. No partial state: either the tenant is fully archived and fully gone, or nothing happened.
- The archive's `archiveUrl` is never exposed directly to the browser for download — the admin UI downloads through an authenticated proxy route, not the raw Vercel Blob URL (a deliberate refinement over the spec's literal text, made during planning once the Blob API's public-URL-only access model was confirmed — see Task 8's note).
- Every new DB-touching Vitest `it()` needs `{ timeout: 30000 }` — this project's convention for real Neon network round-trips.
- All new admin-facing UI text can stay plain English (the existing admin panel, unlike the tenant-facing app, is not bilingual — confirmed by reading `src/app/admin/(protected)/tenants/page.tsx` and `tenants-list-client.tsx`, neither of which goes through the `useLocale()`/dictionary system).

---

### Task 1: `TenantArchive` model, cascading deletes, and dependencies

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `package.json` (add `@vercel/blob`, `jszip`)

**Interfaces:**
- Produces: `TenantArchive` Prisma model, and `onDelete: Cascade` on every tenant-scoped relation — required by every later task in this plan.

- [ ] **Step 1: Add the `TenantArchive` model**

Add this block to `prisma/schema.prisma`, after the `NumberLease` model:

```prisma
model TenantArchive {
  id                     String      @id @default(uuid())
  // Deliberately NOT a foreign key to Tenant -- this record must survive the
  // Tenant row (and everything under it) being deleted entirely.
  originalTenantId       String
  legalName              String
  tradeNameEn            String
  tradeNameAr            String?
  vatNumber              String
  crNumber               String?
  phone                  String?
  address                String?
  joinedAt               DateTime
  deletedAt              DateTime    @default(now())
  deletedByAgencyStaffId String
  deletedByAgencyStaff   AgencyStaff @relation(fields: [deletedByAgencyStaffId], references: [id])
  receiptCount           Int
  quotationCount         Int
  earliestDocumentAt     DateTime?
  latestDocumentAt       DateTime?
  archiveUrl             String

  @@index([vatNumber])
}
```

Add the reverse relation to the existing `AgencyStaff` model (find it in the schema and add this line alongside its existing `auditLogs AuditLog[]` line):

```prisma
  tenantArchives TenantArchive[]
```

- [ ] **Step 2: Add `onDelete: Cascade` to every tenant-scoped relation**

Every model below has a `tenant Tenant @relation(fields: [tenantId], references: [id])` line (or, for `Settings`, the same shape). Add `, onDelete: Cascade` to each one, in these models: `Settings`, `User`, `Customer`, `Product`, `Document`, `DocumentLine`, `Supplier`, `PurchaseReceipt`, `PurchaseReceiptLine`, `StockMovement`, `NumberLease`.

For example, in `model Customer`:

```prisma
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
```

Apply the identical pattern (just adding `, onDelete: Cascade` to the existing relation line) in each of the other 10 models listed above. Do not change any other field on these models.

**Two relations need a second look, since they reference something other than `Tenant` directly and must NOT cascade from tenant deletion in a way that breaks something outside this tenant:**
- `Document.creditNoteOf`/`creditNotes` (the self-relation) — leave unchanged, not tenant-scoped directly.
- `StockMovement.supplier`, `StockMovement.document`, `StockMovement.purchaseReceipt`, `DocumentLine.product`, `DocumentLine.document`, `PurchaseReceiptLine.product`, `PurchaseReceiptLine.purchaseReceipt` — these are all *within* the same tenant's own data (a `StockMovement` row and the `Product` it references are always in the same tenant), so once `onDelete: Cascade` removes the tenant's `Document`/`Product`/`Supplier`/`PurchaseReceipt` rows via their own `tenant` relation, these child rows get removed as part of that same cascade naturally — no change needed on these specific relations themselves.

- [ ] **Step 3: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_tenant_archive_and_cascade_deletes`
Expected: a new migration folder under `prisma/migrations/` containing `CREATE TABLE "TenantArchive"` plus a series of `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ... ON DELETE CASCADE` statements (one pair per relation changed in Step 2), applied to the local dev database without error.

- [ ] **Step 4: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: exits 0; `@prisma/client` now exports a `TenantArchive` type.

- [ ] **Step 5: Install the new dependencies**

Run: `npm install @vercel/blob jszip`
Expected: `package.json`'s `dependencies` gains both packages.

- [ ] **Step 6: Verify the cascade actually works, with a throwaway manual check**

Run this one-off script to confirm a tenant with related rows can now actually be deleted (delete it afterward from the script itself, so it doesn't leave debris):

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const tenant = await p.tenant.create({ data: { legalName: 'Cascade Test', tradeNameEn: 'Cascade Test Shop', vatNumber: '300000000099901' } });
  await p.settings.create({ data: { tenantId: tenant.id } });
  await p.customer.create({ data: { tenantId: tenant.id, name: 'Test Customer', isWalkIn: true } });
  const deleted = await p.tenant.delete({ where: { id: tenant.id } });
  console.log('Deleted tenant and cascaded children successfully:', deleted.id);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
"
```

Expected: prints "Deleted tenant and cascaded children successfully: <id>", exit code 0. If this throws a foreign key error, Step 2 missed a relation — find which table still blocks the delete from the error message and fix it before moving on.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations package.json package-lock.json
git commit -m "Add TenantArchive model and cascading deletes for tenant removal"
```

---

### Task 2: Gather a tenant's full dataset

**Files:**
- Create: `src/lib/tenant-deletion/gather-tenant-data.ts`
- Test: `src/lib/tenant-deletion/gather-tenant-data.test.ts`

**Interfaces:**
- Produces: `gatherTenantData(tenantId: string): Promise<GatheredTenantData>` — used by Task 3 (archive builder) and Task 6 (the delete route, for the summary counts written into `TenantArchive`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/tenant-deletion/gather-tenant-data.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { gatherTenantData } from "./gather-tenant-data";

let tenantId: string;

describe("gatherTenantData", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Gather Test Co", tradeNameEn: "Gather Test Shop", vatNumber: "300000000000701" },
    });
    tenantId = tenant.id;
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Gathered Product", sku: "SKU-GT-1", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput })
    );
    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          type: "SALES_RECEIPT",
          number: 1,
          customerId: customer.id,
          subtotal: 10,
          vatTotal: 1.5,
          grandTotal: 11.5,
          lines: { create: [{ tenantId, productId: product.id, productName: "Gathered Product", quantity: 1, unitPrice: 10, vatRate: 15, lineSubtotal: 10, lineVat: 1.5, lineTotal: 11.5 }] },
        } as Prisma.DocumentUncheckedCreateInput,
      })
    );
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: { type: "QUOTATION", number: 1, customerId: customer.id, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5 } as Prisma.DocumentUncheckedCreateInput,
      })
    );
  }, 30000);

  afterAll(async () => {
    await prisma.documentLine.deleteMany({ where: { tenantId } });
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("gathers every tenant-scoped table and the right summary counts", { timeout: 30000 }, async () => {
    const data = await gatherTenantData(tenantId);

    expect(data.tenant.tradeNameEn).toBe("Gather Test Shop");
    expect(data.products).toHaveLength(1);
    expect(data.customers).toHaveLength(1);
    expect(data.receipts).toHaveLength(1);
    expect(data.quotations).toHaveLength(1);
    expect(data.receipts[0].lines).toHaveLength(1);
    expect(data.summary.receiptCount).toBe(1);
    expect(data.summary.quotationCount).toBe(1);
    expect(data.summary.earliestDocumentAt).not.toBeNull();
    expect(data.summary.latestDocumentAt).not.toBeNull();
  });

  it("returns zeroed summary counts and empty arrays for a tenant with no documents", { timeout: 30000 }, async () => {
    const empty = await prisma.tenant.create({
      data: { legalName: "Empty Gather Co", tradeNameEn: "Empty Gather Shop", vatNumber: "300000000000718" },
    });
    try {
      const data = await gatherTenantData(empty.id);
      expect(data.receipts).toHaveLength(0);
      expect(data.summary.receiptCount).toBe(0);
      expect(data.summary.earliestDocumentAt).toBeNull();
    } finally {
      await prisma.tenant.delete({ where: { id: empty.id } });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/tenant-deletion/gather-tenant-data.test.ts`
Expected: FAIL with "Cannot find module './gather-tenant-data'".

- [ ] **Step 3: Implement the gatherer**

Create `src/lib/tenant-deletion/gather-tenant-data.ts`:

```ts
import type { Customer, Document, DocumentLine, Product, PurchaseReceipt, PurchaseReceiptLine, StockMovement, Supplier, Tenant } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export interface GatheredTenantData {
  tenant: Tenant;
  customers: Customer[];
  products: Product[];
  suppliers: Supplier[];
  receipts: (Document & { customer: Customer; lines: DocumentLine[] })[];
  quotations: (Document & { customer: Customer; lines: DocumentLine[] })[];
  purchaseReceipts: (PurchaseReceipt & { lines: PurchaseReceiptLine[] })[];
  stockMovements: StockMovement[];
  summary: {
    receiptCount: number;
    quotationCount: number;
    earliestDocumentAt: Date | null;
    latestDocumentAt: Date | null;
  };
}

// Everything under one tenant, fetched once, in the exact shape the archive
// builder (Task 3) and the delete route's summary fields (Task 6) both need.
// Deliberately reads through withTenant() -- this only ever runs as part of
// the CTO-only delete flow, but there is no reason to bypass the same
// tenant-scoping guarantee every other query in this codebase relies on.
export async function gatherTenantData(tenantId: string): Promise<GatheredTenantData> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const [customers, products, suppliers, allDocuments, purchaseReceipts, stockMovements] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.customer.findMany(),
      tx.product.findMany(),
      tx.supplier.findMany(),
      tx.document.findMany({ include: { customer: true, lines: true }, orderBy: { createdAt: "asc" } }),
      tx.purchaseReceipt.findMany({ include: { lines: true } }),
      tx.stockMovement.findMany(),
    ])
  );

  const receipts = allDocuments.filter((d) => d.type === "SALES_RECEIPT");
  const quotations = allDocuments.filter((d) => d.type === "QUOTATION");

  return {
    tenant,
    customers,
    products,
    suppliers,
    receipts,
    quotations,
    purchaseReceipts,
    stockMovements,
    summary: {
      receiptCount: receipts.length,
      quotationCount: quotations.length,
      earliestDocumentAt: allDocuments[0]?.createdAt ?? null,
      latestDocumentAt: allDocuments[allDocuments.length - 1]?.createdAt ?? null,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tenant-deletion/gather-tenant-data.test.ts`
Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant-deletion/gather-tenant-data.ts src/lib/tenant-deletion/gather-tenant-data.test.ts
git commit -m "Add gatherTenantData for the tenant deletion export"
```

---

### Task 3: Build the archive zip

**Files:**
- Create: `src/lib/tenant-deletion/build-archive.ts`
- Test: `src/lib/tenant-deletion/build-archive.test.ts`

**Interfaces:**
- Consumes: `GatheredTenantData` (Task 2).
- Produces: `buildTenantArchive(data: GatheredTenantData): Promise<Buffer>` — a zip file buffer, used by Task 4 (upload).

- [ ] **Step 1: Write the failing test**

Create `src/lib/tenant-deletion/build-archive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { GatheredTenantData } from "./gather-tenant-data";
import { buildTenantArchive } from "./build-archive";

function sampleData(): GatheredTenantData {
  const tenant = {
    id: "tenant-1", legalName: "Archive Test Co", tradeNameEn: "Archive Test Shop", tradeNameAr: null,
    vatNumber: "300000000000725", crNumber: null, address: null, phone: null, defaultLocale: "en",
    createdAt: new Date("2026-01-01"), nextProductSkuNumber: 1, nextSalesReceiptNumber: 2, nextQuotationNumber: 1,
    nextPurchaseReceiptNumber: 1, lastSalesReceiptHash: null, billingStatus: "ACTIVE", trialEndsAt: null, featureFlags: {},
  } as GatheredTenantData["tenant"];

  const customer = {
    id: "cust-1", tenantId: "tenant-1", name: "Walk-in Customer", vatId: null, address: null, phone: null,
    crNumber: null, isWalkIn: true, isActive: true, createdAt: new Date("2026-01-01"),
  } as GatheredTenantData["customers"][number];

  const receiptLine = {
    id: "line-1", tenantId: "tenant-1", documentId: "doc-1", productId: "prod-1", productName: "Test Product",
    quantity: 1 as unknown as number, unitPrice: 10 as unknown as number, discount: 0 as unknown as number,
    vatRate: 15 as unknown as number, lineSubtotal: 10 as unknown as number, lineVat: 1.5 as unknown as number,
    lineTotal: 11.5 as unknown as number,
  };

  const receipt = {
    id: "doc-1", tenantId: "tenant-1", type: "SALES_RECEIPT", number: 1, customerId: "cust-1", customer,
    subtotal: 10 as unknown as number, vatTotal: 1.5 as unknown as number, grandTotal: 11.5 as unknown as number,
    notes: null, creditNoteOfDocumentId: null, uuid: "uuid-1", invoiceHash: null, previousInvoiceHash: null,
    qrCode: null, createdAt: new Date("2026-01-02"), lines: [receiptLine],
  } as unknown as GatheredTenantData["receipts"][number];

  return {
    tenant, customers: [customer], products: [], suppliers: [], receipts: [receipt], quotations: [],
    purchaseReceipts: [], stockMovements: [],
    summary: { receiptCount: 1, quotationCount: 0, earliestDocumentAt: receipt.createdAt, latestDocumentAt: receipt.createdAt },
  };
}

describe("buildTenantArchive", () => {
  it("produces a zip with manifest.json, data.json, and one PDF per receipt", { timeout: 30000 }, async () => {
    const buffer = await buildTenantArchive(sampleData());
    const zip = await JSZip.loadAsync(buffer);

    expect(zip.file("manifest.json")).not.toBeNull();
    expect(zip.file("data.json")).not.toBeNull();
    expect(zip.file("receipts/1.pdf")).not.toBeNull();

    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.tradeNameEn).toBe("Archive Test Shop");
    expect(manifest.receiptCount).toBe(1);

    const data = JSON.parse(await zip.file("data.json")!.async("string"));
    expect(data.customers).toHaveLength(1);

    const pdfBytes = await zip.file("receipts/1.pdf")!.async("uint8array");
    expect(pdfBytes.length).toBeGreaterThan(0);
  });

  it("produces a zip with no receipts/ or quotations/ folder entries when there are none", { timeout: 30000 }, async () => {
    const data = sampleData();
    data.receipts = [];
    data.summary.receiptCount = 0;
    const buffer = await buildTenantArchive(data);
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("receipts/1.pdf")).toBeNull();
    expect(zip.file("manifest.json")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/tenant-deletion/build-archive.test.ts`
Expected: FAIL with "Cannot find module './build-archive'".

- [ ] **Step 3: Implement the archive builder**

Create `src/lib/tenant-deletion/build-archive.ts`:

```ts
import JSZip from "jszip";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReceiptPdfDocument } from "@/lib/receipts/receipt-pdf";
import { ReceiptPdfA4Document } from "@/lib/receipts/receipt-pdf-a4";
import { QuotationPdfDocument } from "@/lib/quotations/quotation-pdf";
import { QuotationPdfA4Document } from "@/lib/quotations/quotation-pdf-a4";
import type { GatheredTenantData } from "./gather-tenant-data";

// Builds the full export archive as an in-memory zip. Every receipt and
// quotation is rendered through the exact same PDF components the app
// already uses for live downloads (src/app/api/receipts/[id]/pdf/route.tsx),
// so an archived document looks identical to what was actually handed to
// the customer -- a JSON dump alone would not be an acceptable substitute
// for a real invoice if this tenant's records were ever audited.
export async function buildTenantArchive(data: GatheredTenantData): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        originalTenantId: data.tenant.id,
        legalName: data.tenant.legalName,
        tradeNameEn: data.tenant.tradeNameEn,
        tradeNameAr: data.tenant.tradeNameAr,
        vatNumber: data.tenant.vatNumber,
        crNumber: data.tenant.crNumber,
        phone: data.tenant.phone,
        address: data.tenant.address,
        joinedAt: data.tenant.createdAt,
        exportedAt: new Date().toISOString(),
        receiptCount: data.summary.receiptCount,
        quotationCount: data.summary.quotationCount,
        customerCount: data.customers.length,
        productCount: data.products.length,
        supplierCount: data.suppliers.length,
        purchaseReceiptCount: data.purchaseReceipts.length,
        earliestDocumentAt: data.summary.earliestDocumentAt,
        latestDocumentAt: data.summary.latestDocumentAt,
      },
      null,
      2
    )
  );

  zip.file(
    "data.json",
    JSON.stringify(
      {
        tenant: data.tenant,
        customers: data.customers,
        products: data.products,
        suppliers: data.suppliers,
        receipts: data.receipts,
        quotations: data.quotations,
        purchaseReceipts: data.purchaseReceipts,
        stockMovements: data.stockMovements,
      },
      null,
      2
    )
  );

  // A4 is the safer default for an archive meant to be opened and read by a
  // human later (auditor, the client themselves) rather than printed on a
  // thermal till -- independent of whatever print format the tenant's own
  // Settings had configured while they were active.
  for (const receipt of data.receipts) {
    const buffer = await renderToBuffer(
      <ReceiptPdfA4Document tenant={data.tenant} document={receipt} qrImageDataUrl={null} />
    );
    zip.file(`receipts/${receipt.number}.pdf`, buffer);
  }

  for (const quotation of data.quotations) {
    const buffer = await renderToBuffer(<QuotationPdfA4Document tenant={data.tenant} document={quotation} />);
    zip.file(`quotations/${quotation.number}.pdf`, buffer);
  }

  return zip.generateAsync({ type: "nodebuffer" });
}
```

**Note for the implementer:** check `ReceiptPdfA4Document`'s exact prop types in `src/lib/receipts/receipt-pdf-a4.tsx` before wiring this up — the brief above assumes it accepts `qrImageDataUrl: string | null` matching `ReceiptPdfDocument`'s sibling component (both are used interchangeably by `src/app/api/receipts/[id]/pdf/route.tsx`, which passes the same `qrImageDataUrl` to whichever one it picks based on `printFormat`). If the actual prop name or nullability differs, use what the component's real type declares instead of this snippet's assumption, and note the difference in your report.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tenant-deletion/build-archive.test.ts`
Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant-deletion/build-archive.ts src/lib/tenant-deletion/build-archive.test.ts
git commit -m "Add buildTenantArchive to render the full export zip"
```

---

### Task 4: Upload to Vercel Blob and verify

**Files:**
- Create: `src/lib/tenant-deletion/upload-archive.ts`
- Test: `src/lib/tenant-deletion/upload-archive.test.ts`

**Interfaces:**
- Produces: `uploadTenantArchive(tenantId: string, buffer: Buffer): Promise<{ url: string }>` — throws if the upload cannot be verified. Used by Task 6 (the delete route).

**Prerequisite, not code:** Vercel Blob must be enabled on this project's Vercel dashboard (Storage tab → Create Database → Blob) before this task's code can work against a real deployment. Locally, `@vercel/blob` reads a `BLOB_READ_WRITE_TOKEN` environment variable — get this from the Vercel dashboard once Blob is enabled, and add it to `.env.local` (never commit it). This task's own test is skipped in CI/local runs without that token (see Step 1) rather than failing the whole suite on missing infra.

- [ ] **Step 1: Write the (conditionally-skipped) test**

Create `src/lib/tenant-deletion/upload-archive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { uploadTenantArchive } from "./upload-archive";

const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

describe.skipIf(!hasBlobToken)("uploadTenantArchive", () => {
  it("uploads and returns a verified, reachable URL", { timeout: 30000 }, async () => {
    const buffer = Buffer.from("test archive contents");
    const result = await uploadTenantArchive("upload-test-tenant", buffer);

    expect(result.url).toMatch(/^https:\/\//);

    const response = await fetch(result.url);
    expect(response.ok).toBe(true);
    const downloaded = Buffer.from(await response.arrayBuffer());
    expect(downloaded.equals(buffer)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it's skipped (no token configured yet) or fails (module missing)**

Run: `npx vitest run src/lib/tenant-deletion/upload-archive.test.ts`
Expected: FAIL with "Cannot find module './upload-archive'" (the module doesn't exist yet — this is expected regardless of whether the Blob token is set).

- [ ] **Step 3: Implement the uploader**

Create `src/lib/tenant-deletion/upload-archive.ts`:

```ts
import { put, head } from "@vercel/blob";

// Uploads the archive, then independently re-fetches its metadata to confirm
// it actually landed -- a successful `put()` response alone is not treated
// as proof, per the delete flow's core safety requirement (spec S4.2): the
// tenant must never be deleted on the strength of an unverified upload.
export async function uploadTenantArchive(tenantId: string, buffer: Buffer): Promise<{ url: string }> {
  const pathname = `tenant-archives/${tenantId}-${Date.now()}.zip`;
  const blob = await put(pathname, buffer, { access: "public", contentType: "application/zip" });

  const verified = await head(blob.url);
  if (!verified || verified.size !== buffer.length) {
    throw new Error(`Archive upload for tenant ${tenantId} could not be verified (expected ${buffer.length} bytes)`);
  }

  return { url: blob.url };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/tenant-deletion/upload-archive.test.ts`
Expected: if `BLOB_READ_WRITE_TOKEN` is set locally, PASS. If not set, the test reports as skipped (not failed) — this is expected and acceptable for this task; Task 6's route-level tests (which exercise the full delete flow) are the ones that need real Blob access to run meaningfully, and they carry the same skip guard.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant-deletion/upload-archive.ts src/lib/tenant-deletion/upload-archive.test.ts
git commit -m "Add uploadTenantArchive with post-upload verification"
```

---

### Task 5: Retention-window helper

**Files:**
- Create: `src/lib/tenant-deletion/retention-window.ts`
- Test: `src/lib/tenant-deletion/retention-window.test.ts`

**Interfaces:**
- Produces: `isWithinRetentionWindow(latestDocumentAt: Date | null): boolean` — used by Task 6 (delete route response) and Task 11 (confirmation dialog).

- [ ] **Step 1: Write the failing test**

Create `src/lib/tenant-deletion/retention-window.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isWithinRetentionWindow } from "./retention-window";

describe("isWithinRetentionWindow", () => {
  it("is true for a document created 1 year ago", () => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    expect(isWithinRetentionWindow(oneYearAgo)).toBe(true);
  });

  it("is false for a document created 7 years ago", () => {
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
    expect(isWithinRetentionWindow(sevenYearsAgo)).toBe(false);
  });

  it("is false when there is no document at all", () => {
    expect(isWithinRetentionWindow(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/tenant-deletion/retention-window.test.ts`
Expected: FAIL with "Cannot find module './retention-window'".

- [ ] **Step 3: Implement**

Create `src/lib/tenant-deletion/retention-window.ts`:

```ts
// Saudi VAT record-retention baseline is ~6 years. This is informational
// only -- see spec S5: it never blocks deletion, it just tells the CTO
// whether to expect this client's records are still inside that window
// before they confirm. A tenant with no documents at all has nothing to
// retain, so it's never "within" the window.
const RETENTION_YEARS = 6;

export function isWithinRetentionWindow(latestDocumentAt: Date | null): boolean {
  if (!latestDocumentAt) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
  return latestDocumentAt.getTime() >= cutoff.getTime();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tenant-deletion/retention-window.test.ts`
Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant-deletion/retention-window.ts src/lib/tenant-deletion/retention-window.test.ts
git commit -m "Add the retention-window helper for the delete warning"
```

---

### Task 6: The delete route

This is the task that wires Tasks 1-5 together into the actual ordered flow.

**Files:**
- Create: `src/app/api/admin/tenants/[id]/delete/route.ts`
- Test: `src/app/api/admin/tenants/[id]/delete/route.test.ts`
- Modify: `src/lib/admin-auth/audit-actions.ts` (add the `TENANT_DELETED` entry)

**Interfaces:**
- Consumes: `gatherTenantData` (Task 2), `buildTenantArchive` (Task 3), `uploadTenantArchive` (Task 4), `getAdminSession`/`assertCtoRole` (existing), `AUDIT_ACTIONS`/`writeAuditLog` (existing).

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/admin/tenants/[id]/delete/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST } from "./route";

const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

let ctoId: string;
let developerId: string;
let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

// Failure-injection switches for the ordered-flow tests below (spec S8:
// "each failure-injection case ... confirming the tenant and all its data
// are provably untouched afterward"). Each mock calls straight through to
// the real implementation unless its switch is on, so the happy-path test
// and the 403/401/404 tests are unaffected by this mocking.
const inject = { gather: false, build: false, upload: false };

vi.mock("@/lib/tenant-deletion/gather-tenant-data", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-deletion/gather-tenant-data")>(
    "@/lib/tenant-deletion/gather-tenant-data"
  );
  return {
    gatherTenantData: async (...args: Parameters<typeof actual.gatherTenantData>) => {
      if (inject.gather) throw new Error("Injected gather failure");
      return actual.gatherTenantData(...args);
    },
  };
});

vi.mock("@/lib/tenant-deletion/build-archive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-deletion/build-archive")>(
    "@/lib/tenant-deletion/build-archive"
  );
  return {
    buildTenantArchive: async (...args: Parameters<typeof actual.buildTenantArchive>) => {
      if (inject.build) throw new Error("Injected build failure");
      return actual.buildTenantArchive(...args);
    },
  };
});

vi.mock("@/lib/tenant-deletion/upload-archive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-deletion/upload-archive")>(
    "@/lib/tenant-deletion/upload-archive"
  );
  return {
    uploadTenantArchive: async (...args: Parameters<typeof actual.uploadTenantArchive>) => {
      if (inject.upload) throw new Error("Injected upload failure");
      return actual.uploadTenantArchive(...args);
    },
  };
});

function req() {
  return new Request("http://localhost/api/admin/tenants/x/delete", { method: "POST" });
}

async function createTestTenant(vatNumber: string) {
  const tenant = await prisma.tenant.create({
    data: { legalName: "Failure Injection Co", tradeNameEn: "Failure Injection Shop", vatNumber },
  });
  await withTenant(tenant.id, (tx) => tx.settings.create({ data: { tenantId: tenant.id } }));
  return tenant;
}

describe("POST /api/admin/tenants/[id]/delete", () => {
  beforeAll(async () => {
    const cto = await prisma.agencyStaff.create({ data: { email: `cto-${Date.now()}@test.local`, passwordHash: "x", role: "CTO" } });
    ctoId = cto.id;
    const dev = await prisma.agencyStaff.create({ data: { email: `dev-${Date.now()}@test.local`, passwordHash: "x", role: "DEVELOPER" } });
    developerId = dev.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
  }, 30000);

  afterAll(async () => {
    await prisma.tenantArchive.deleteMany({ where: { deletedByAgencyStaffId: { in: [ctoId, developerId] } } });
    await prisma.agencyStaff.deleteMany({ where: { id: { in: [ctoId, developerId] } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    inject.gather = false;
    inject.build = false;
    inject.upload = false;
  });

  it("leaves the tenant and all its data untouched when gathering fails", { timeout: 30000 }, async () => {
    const tenant = await createTestTenant("300000000000787");
    try {
      inject.gather = true;
      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(500);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).not.toBeNull();
      const archiveCount = await prisma.tenantArchive.count({ where: { originalTenantId: tenant.id } });
      expect(archiveCount).toBe(0);
    } finally {
      await prisma.settings.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it("leaves the tenant and all its data untouched when building the archive fails", { timeout: 30000 }, async () => {
    const tenant = await createTestTenant("300000000000794");
    try {
      inject.build = true;
      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(500);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).not.toBeNull();
      const archiveCount = await prisma.tenantArchive.count({ where: { originalTenantId: tenant.id } });
      expect(archiveCount).toBe(0);
    } finally {
      await prisma.settings.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it("leaves the tenant and all its data untouched when the upload fails to verify", { timeout: 30000 }, async () => {
    const tenant = await createTestTenant("300000000000800");
    try {
      inject.upload = true;
      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(500);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).not.toBeNull();
      const archiveCount = await prisma.tenantArchive.count({ where: { originalTenantId: tenant.id } });
      expect(archiveCount).toBe(0);
    } finally {
      await prisma.settings.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it.skipIf(!hasBlobToken)(
    "cascades through every tenant-scoped table, not just the ones exercised elsewhere",
    { timeout: 30000 },
    async () => {
      const tenant = await prisma.tenant.create({
        data: { legalName: "Full Cascade Co", tradeNameEn: "Full Cascade Shop", vatNumber: "300000000000817" },
      });
      await withTenant(tenant.id, (tx) => tx.settings.create({ data: { tenantId: tenant.id } }));

      const product = await withTenant(tenant.id, (tx) =>
        tx.product.create({ data: { nameEn: "Cascade Product", sku: "SKU-FC-1", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput })
      );
      const customer = await withTenant(tenant.id, (tx) =>
        tx.customer.create({ data: { name: "Cascade Customer", isWalkIn: false } as Prisma.CustomerUncheckedCreateInput })
      );
      const supplier = await withTenant(tenant.id, (tx) =>
        tx.supplier.create({ data: { name: "Cascade Supplier" } as Prisma.SupplierUncheckedCreateInput })
      );
      const receipt = await withTenant(tenant.id, (tx) =>
        tx.document.create({
          data: {
            type: "SALES_RECEIPT", number: 1, customerId: customer.id, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5,
            lines: { create: [{ tenantId: tenant.id, productId: product.id, productName: "Cascade Product", quantity: 1, unitPrice: 10, vatRate: 15, lineSubtotal: 10, lineVat: 1.5, lineTotal: 11.5 }] },
          } as Prisma.DocumentUncheckedCreateInput,
        })
      );
      const purchaseReceipt = await withTenant(tenant.id, (tx) =>
        tx.purchaseReceipt.create({
          data: {
            number: 1, supplierId: supplier.id, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5,
            lines: { create: [{ tenantId: tenant.id, productId: product.id, productName: "Cascade Product", quantity: 1, unitCost: 10, vatRate: 15, lineSubtotal: 10, lineVat: 1.5, lineTotal: 11.5 }] },
          } as Prisma.PurchaseReceiptUncheckedCreateInput,
        })
      );
      await withTenant(tenant.id, (tx) =>
        tx.stockMovement.create({
          data: { productId: product.id, quantityChange: 5, reason: "PURCHASE_RECEIPT", purchaseReceiptId: purchaseReceipt.id } as Prisma.StockMovementUncheckedCreateInput,
        })
      );
      await withTenant(tenant.id, (tx) =>
        tx.numberLease.create({ data: { documentType: "SALES_RECEIPT", deviceId: "cascade-device", leasedNumber: 2 } as Prisma.NumberLeaseUncheckedCreateInput })
      );

      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(200);

      const [settings, customers, products, suppliers, documents, documentLines, purchaseReceipts, purchaseReceiptLines, stockMovements, numberLeases] =
        await Promise.all([
          prisma.settings.count({ where: { tenantId: tenant.id } }),
          prisma.customer.count({ where: { tenantId: tenant.id } }),
          prisma.product.count({ where: { tenantId: tenant.id } }),
          prisma.supplier.count({ where: { tenantId: tenant.id } }),
          prisma.document.count({ where: { tenantId: tenant.id } }),
          prisma.documentLine.count({ where: { tenantId: tenant.id } }),
          prisma.purchaseReceipt.count({ where: { tenantId: tenant.id } }),
          prisma.purchaseReceiptLine.count({ where: { tenantId: tenant.id } }),
          prisma.stockMovement.count({ where: { tenantId: tenant.id } }),
          prisma.numberLease.count({ where: { tenantId: tenant.id } }),
        ]);

      expect({ settings, customers, products, suppliers, documents, documentLines, purchaseReceipts, purchaseReceiptLines, stockMovements, numberLeases }).toEqual({
        settings: 0, customers: 0, products: 0, suppliers: 0, documents: 0, documentLines: 0,
        purchaseReceipts: 0, purchaseReceiptLines: 0, stockMovements: 0, numberLeases: 0,
      });

      await prisma.tenantArchive.deleteMany({ where: { originalTenantId: tenant.id } });
    }
  );

  // Implementer note: the StockMovement and PurchaseReceiptLine field names above
  // (`reason`, `purchaseReceiptId`, `unitCost`, etc.) are written from this plan's best
  // understanding of the schema but were not re-verified against prisma/schema.prisma at
  // plan-writing time. Before running this test, open prisma/schema.prisma (updated by
  // Task 1) and correct any field name here that doesn't match the real model exactly --
  // the point of the test is the row-count assertion after delete, not these exact values.

  it.skipIf(!hasBlobToken)(
    "exports, verifies, tombstones, and deletes a tenant with data, on the happy path",
    { timeout: 30000 },
    async () => {
      const tenant = await prisma.tenant.create({
        data: { legalName: "Delete Route Co", tradeNameEn: "Delete Route Shop", vatNumber: "300000000000732" },
      });
      await withTenant(tenant.id, (tx) => tx.settings.create({ data: { tenantId: tenant.id } }));
      const customer = await withTenant(tenant.id, (tx) =>
        tx.customer.create({ data: { name: "Walk-in", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
      );
      await withTenant(tenant.id, (tx) =>
        tx.document.create({
          data: { type: "SALES_RECEIPT", number: 1, customerId: customer.id, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5 } as Prisma.DocumentUncheckedCreateInput,
        })
      );

      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.archiveId).toBeDefined();

      const archive = await prisma.tenantArchive.findUnique({ where: { id: body.archiveId } });
      expect(archive?.originalTenantId).toBe(tenant.id);
      expect(archive?.receiptCount).toBe(1);
      expect(archive?.archiveUrl).toMatch(/^https:\/\//);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).toBeNull();
      const orphanedCustomer = await prisma.customer.findUnique({ where: { id: customer.id } });
      expect(orphanedCustomer).toBeNull();
    }
  );

  it("returns 403 and leaves the tenant untouched for a DEVELOPER-role caller", { timeout: 30000 }, async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Forbidden Delete Co", tradeNameEn: "Forbidden Delete Shop", vatNumber: "300000000000749" },
    });
    try {
      mockSession = { user: { agencyStaffId: developerId, role: "DEVELOPER" } };
      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(403);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(req(), { params: Promise.resolve({ id: "does-not-matter" }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("returns 404 for a tenant that does not exist", { timeout: 30000 }, async () => {
    const response = await POST(req(), { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/admin/tenants/[id]/delete/route.test.ts`
Expected: FAIL with "Cannot find module './route'".

- [ ] **Step 3: Implement the route**

Create `src/app/api/admin/tenants/[id]/delete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { assertCtoRole } from "@/lib/admin-auth/require-cto";
import { AUDIT_ACTIONS } from "@/lib/admin-auth/audit-actions";
import { writeAuditLog } from "@/lib/admin-auth/audit-log";
import { gatherTenantData } from "@/lib/tenant-deletion/gather-tenant-data";
import { buildTenantArchive } from "@/lib/tenant-deletion/build-archive";
import { uploadTenantArchive } from "@/lib/tenant-deletion/upload-archive";

// Strict ordering per spec S4.2: gather -> build -> upload -> verify -> write
// tombstone -> delete tenant. Each step's failure throws and stops the whole
// request before the next step runs -- there is no partial-completion state
// where some but not all of this has happened, because the tenant row (and
// everything under it) is only ever touched in the very last step, after
// everything else has already succeeded.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const forbidden = assertCtoRole(session.user.role);
  if (forbidden) return forbidden;

  const { id } = await params;

  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  // Steps a-c (gather, build, upload+verify) each throw on failure. Catching
  // here, rather than letting the error propagate, is what guarantees the
  // CTO sees a clear error instead of a bare 500 -- and it's what makes the
  // "tenant untouched on failure" guarantee (spec S4.2) observable: nothing
  // below this catch ever runs unless every step above it already succeeded.
  let archiveUrl: string;
  let summary: Awaited<ReturnType<typeof gatherTenantData>>["summary"];
  try {
    const data = await gatherTenantData(id);
    summary = data.summary;
    const archiveBuffer = await buildTenantArchive(data);
    const uploaded = await uploadTenantArchive(id, archiveBuffer);
    archiveUrl = uploaded.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: `Could not export tenant data: ${message}` }, { status: 500 });
  }

  const archive = await prisma.tenantArchive.create({
    data: {
      originalTenantId: id,
      legalName: tenant.legalName,
      tradeNameEn: tenant.tradeNameEn,
      tradeNameAr: tenant.tradeNameAr,
      vatNumber: tenant.vatNumber,
      crNumber: tenant.crNumber,
      phone: tenant.phone,
      address: tenant.address,
      joinedAt: tenant.createdAt,
      deletedByAgencyStaffId: session.user.agencyStaffId,
      receiptCount: summary.receiptCount,
      quotationCount: summary.quotationCount,
      earliestDocumentAt: summary.earliestDocumentAt,
      latestDocumentAt: summary.latestDocumentAt,
      archiveUrl,
    },
  });

  await prisma.tenant.delete({ where: { id } });

  await writeAuditLog({
    agencyStaffId: session.user.agencyStaffId,
    action: AUDIT_ACTIONS.TENANT_DELETED,
    metadata: { tradeNameEn: tenant.tradeNameEn, archiveId: archive.id },
  });

  return NextResponse.json({ archiveId: archive.id });
}
```

Add the new action to `src/lib/admin-auth/audit-actions.ts`:

```ts
  TENANT_DELETED: "TENANT_DELETED",
```

(add this line inside the existing `AUDIT_ACTIONS` object, alongside `TENANT_CREATED`, etc.)

**Note for the implementer:** `writeAuditLog`'s `tenantId` field is optional (`tenantId?: string`, per its existing signature) — deliberately omitted here since the tenant is already gone by the time this log is written; the `archiveId` in `metadata` is how this audit entry stays traceable back to what was deleted.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/api/admin/tenants/[id]/delete/route.test.ts`
Expected: PASS for the 401/403/404 tests always. The happy-path test PASSES if `BLOB_READ_WRITE_TOKEN` is configured locally, or reports SKIPPED if not — both are acceptable outcomes for this step; do not treat a skip as a failure, but do not skip investigating an actual FAIL.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/tenants/[id]/delete src/lib/admin-auth/audit-actions.ts
git commit -m "Add the tenant delete route with the full export-verify-delete flow"
```

---

### Task 7: Archived tenants list + detail + authenticated download proxy

**Files:**
- Create: `src/app/api/admin/tenants/archived/route.ts`
- Create: `src/app/api/admin/tenants/archived/[id]/route.ts`
- Create: `src/app/api/admin/tenants/archived/[id]/download/route.ts`
- Test: `src/app/api/admin/tenants/archived/route.test.ts`
- Test: `src/app/api/admin/tenants/archived/[id]/route.test.ts`

**Interfaces:**
- Produces: three GET endpoints consumed by Tasks 12-13 (admin UI).

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/admin/tenants/archived/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { GET } from "./route";

let staffId: string;
let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

describe("GET /api/admin/tenants/archived", () => {
  beforeAll(async () => {
    const staff = await prisma.agencyStaff.create({ data: { email: `archived-list-${Date.now()}@test.local`, passwordHash: "x", role: "CTO" } });
    staffId = staff.id;
    mockSession = { user: { agencyStaffId: staffId, role: "CTO" } };
    await prisma.tenantArchive.create({
      data: {
        originalTenantId: "orig-1", legalName: "Archived Co", tradeNameEn: "Archived Shop", vatNumber: "300000000000756",
        joinedAt: new Date("2025-01-01"), deletedByAgencyStaffId: staffId, receiptCount: 3, quotationCount: 1,
        archiveUrl: "https://example.com/archive.zip",
      },
    });
  }, 30000);

  afterAll(async () => {
    await prisma.tenantArchive.deleteMany({ where: { deletedByAgencyStaffId: staffId } });
    await prisma.agencyStaff.delete({ where: { id: staffId } });
    await prisma.$disconnect();
  });

  it("lists archived tenants for an authenticated staff member", { timeout: 30000 }, async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.archives.some((a: { tradeNameEn: string }) => a.tradeNameEn === "Archived Shop")).toBe(true);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await GET();
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: staffId, role: "CTO" } };
    }
  });
});
```

Create `src/app/api/admin/tenants/archived/[id]/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { GET } from "./route";

let staffId: string;
let archiveId: string;
let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

function req() {
  return new Request("http://localhost/api/admin/tenants/archived/x");
}

describe("GET /api/admin/tenants/archived/[id]", () => {
  beforeAll(async () => {
    const staff = await prisma.agencyStaff.create({ data: { email: `archived-detail-${Date.now()}@test.local`, passwordHash: "x", role: "CTO" } });
    staffId = staff.id;
    mockSession = { user: { agencyStaffId: staffId, role: "CTO" } };
    const archive = await prisma.tenantArchive.create({
      data: {
        originalTenantId: "orig-2", legalName: "Detail Co", tradeNameEn: "Detail Shop", vatNumber: "300000000000763",
        joinedAt: new Date("2025-01-01"), deletedByAgencyStaffId: staffId, receiptCount: 0, quotationCount: 0,
        archiveUrl: "https://example.com/detail-archive.zip",
      },
    });
    archiveId = archive.id;
  }, 30000);

  afterAll(async () => {
    await prisma.tenantArchive.deleteMany({ where: { deletedByAgencyStaffId: staffId } });
    await prisma.agencyStaff.delete({ where: { id: staffId } });
    await prisma.$disconnect();
  });

  it("returns one tombstone's full detail", { timeout: 30000 }, async () => {
    const response = await GET(req(), { params: Promise.resolve({ id: archiveId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tradeNameEn).toBe("Detail Shop");
    expect(body.archiveUrl).toBe("https://example.com/detail-archive.zip");
  });

  it("returns 404 for an archive that does not exist", { timeout: 30000 }, async () => {
    const response = await GET(req(), { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/admin/tenants/archived`
Expected: FAIL, modules don't exist yet.

- [ ] **Step 3: Implement the three routes**

Create `src/app/api/admin/tenants/archived/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const archives = await prisma.tenantArchive.findMany({
    select: { id: true, tradeNameEn: true, legalName: true, vatNumber: true, joinedAt: true, deletedAt: true, receiptCount: true, quotationCount: true },
    orderBy: { deletedAt: "desc" },
  });

  return NextResponse.json({ archives });
}
```

Create `src/app/api/admin/tenants/archived/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const archive = await prisma.tenantArchive.findUnique({ where: { id } });
  if (!archive) {
    return NextResponse.json({ error: "Archive not found" }, { status: 404 });
  }

  return NextResponse.json(archive);
}
```

Create `src/app/api/admin/tenants/archived/[id]/download/route.ts` — this is the authenticated proxy mentioned in Global Constraints: the raw Blob URL is never handed to the browser directly, this route fetches it server-side (with the CTO's session already checked) and streams the bytes back:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const archive = await prisma.tenantArchive.findUnique({ where: { id }, select: { archiveUrl: true, tradeNameEn: true } });
  if (!archive) {
    return NextResponse.json({ error: "Archive not found" }, { status: 404 });
  }

  const blobResponse = await fetch(archive.archiveUrl);
  if (!blobResponse.ok || !blobResponse.body) {
    return NextResponse.json({ error: "Archive could not be retrieved" }, { status: 502 });
  }

  return new NextResponse(blobResponse.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archive.tradeNameEn.replace(/[^a-zA-Z0-9-]/g, "-")}-archive.zip"`,
    },
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/api/admin/tenants/archived`
Expected: PASS — all tests in both files (the download route has no dedicated test in this task; it's covered by the manual verification in Task 13).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/tenants/archived
git commit -m "Add archived-tenant list, detail, and authenticated download routes"
```

---

### Task 8: VAT-number rejoin check on tenant creation

**Files:**
- Modify: `src/app/api/admin/tenants/route.ts`
- Modify: `src/app/api/admin/tenants/route.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/tenants`'s success response gains an optional `matchingArchive` field when the submitted VAT number matches a `TenantArchive`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/api/admin/tenants/route.test.ts` (find its existing `describe` block and add this test, reusing whatever `mockSession`/setup pattern the file already has for a CTO-authenticated POST):

```ts
  it("POST surfaces a matching archived tenant by VAT number without blocking creation", { timeout: 30000 }, async () => {
    const staff = await prisma.agencyStaff.create({ data: { email: `vat-match-${Date.now()}@test.local`, passwordHash: "x", role: "CTO" } });
    const archive = await prisma.tenantArchive.create({
      data: {
        originalTenantId: "orig-vat-match", legalName: "Previously Deleted Co", tradeNameEn: "Previously Deleted Shop",
        vatNumber: "300000000000770", joinedAt: new Date("2025-01-01"), deletedByAgencyStaffId: staff.id,
        receiptCount: 0, quotationCount: 0, archiveUrl: "https://example.com/x.zip",
      },
    });
    try {
      const request = new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({
          legalName: "New Owner Co", tradeNameEn: "New Owner Shop", vatNumber: "300000000000770",
          ownerEmail: `rejoin-${Date.now()}@test.local`, ownerPassword: "Password123!",
        }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.matchingArchive?.id).toBe(archive.id);

      await prisma.tenant.delete({ where: { id: body.id } });
    } finally {
      await prisma.tenantArchive.delete({ where: { id: archive.id } });
      await prisma.agencyStaff.delete({ where: { id: staff.id } });
    }
  });

  it("POST leaves matchingArchive null for a VAT number with no archived match", { timeout: 30000 }, async () => {
    const request = new Request("http://localhost/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({
        legalName: "Brand New Co", tradeNameEn: "Brand New Shop", vatNumber: "300000000000824",
        ownerEmail: `brand-new-${Date.now()}@test.local`, ownerPassword: "Password123!",
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.matchingArchive).toBeNull();

    await prisma.tenant.delete({ where: { id: body.id } });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/admin/tenants/route.test.ts`
Expected: FAIL — the new test's `body.matchingArchive` assertion fails since the route doesn't set that field yet.

- [ ] **Step 3: Modify the route**

In `src/app/api/admin/tenants/route.ts`, inside the `POST` handler, after `seedTenant(...)` succeeds and before the `writeAuditLog` call, add the VAT-match lookup:

```ts
    const matchingArchive = await prisma.tenantArchive.findFirst({
      where: { vatNumber },
      select: { id: true, tradeNameEn: true, deletedAt: true },
      orderBy: { deletedAt: "desc" },
    });
```

Then change the final success response to include it:

```ts
    return NextResponse.json(
      { id: result.tenant.id, tradeNameEn: result.tenant.tradeNameEn, vatNumber: result.tenant.vatNumber, matchingArchive },
      { status: 201 }
    );
```

`matchingArchive` will be `null` when there's no match — this is additive to the existing response shape, every existing field stays exactly as it was.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/api/admin/tenants/route.test.ts`
Expected: PASS — the new test and every pre-existing one.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/tenants/route.ts src/app/api/admin/tenants/route.test.ts
git commit -m "Surface a matching archived tenant by VAT number on new-tenant creation"
```

---

### Task 9: Delete confirmation dialog component

**Files:**
- Create: `src/components/admin/tenant-delete-dialog.tsx`

**Interfaces:**
- Consumes: `isWithinRetentionWindow` (Task 5).
- Produces: `TenantDeleteDialog` component, consumed by Task 10.

- [ ] **Step 1: Implement**

Create `src/components/admin/tenant-delete-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { isWithinRetentionWindow } from "@/lib/tenant-deletion/retention-window";

export interface TenantDeleteSummary {
  tradeNameEn: string;
  receiptCount: number;
  quotationCount: number;
  customerCount: number;
  productCount: number;
  latestDocumentAt: string | null;
}

// Deliberately stricter than the existing DeleteConfirmDialog
// (src/components/ui/delete-confirm-dialog.tsx, which has no typed
// confirmation step) -- this removes an entire client's history, not one
// product row, and the confirm button stays disabled until the exact trade
// name is typed.
export function TenantDeleteDialog({
  open,
  onOpenChange,
  tenant,
  deleting,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: TenantDeleteSummary;
  deleting: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const [typedName, setTypedName] = useState("");
  const nameMatches = typedName.trim() === tenant.tradeNameEn;
  const withinRetention = isWithinRetentionWindow(tenant.latestDocumentAt ? new Date(tenant.latestDocumentAt) : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        if (!next) setTypedName("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {tenant.tradeNameEn}?</DialogTitle>
          <DialogDescription>
            This permanently removes the client and everything under them from the live database. A full export is
            generated and archived before anything is deleted, and can be downloaded from the Deleted Clients list
            afterward.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Receipts</span>
            <span className="font-medium text-neutral-900">{tenant.receiptCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Quotations</span>
            <span className="font-medium text-neutral-900">{tenant.quotationCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Customers</span>
            <span className="font-medium text-neutral-900">{tenant.customerCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Products</span>
            <span className="font-medium text-neutral-900">{tenant.productCount}</span>
          </div>
        </div>

        {withinRetention && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            This client has records from within the ~6-year VAT record-retention window. An export will still be
            made before deletion, but confirm this is intentional.
          </p>
        )}

        <label className="text-xs font-medium text-neutral-700">
          Type <span className="font-mono">{tenant.tradeNameEn}</span> to confirm
          <input
            type="text"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            disabled={deleting}
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-600"
          />
        </label>

        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting || !nameMatches} onClick={onConfirm}>
            {deleting && <Loader2Icon className="size-3.5 animate-spin" />}
            Delete Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Note for the implementer:** check `Button`'s actual variant names in `src/components/ui/button.tsx` before using `"destructive"` — the existing `DeleteConfirmDialog` already uses this exact variant name, so it should exist, but confirm rather than assume.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/tenant-delete-dialog.tsx
git commit -m "Add the tenant delete confirmation dialog"
```

(No dedicated test — this is a UI component exercised by Task 13's manual verification, matching this codebase's existing convention for dialog components.)

---

### Task 10: Wire the delete action into the tenant detail page

**Files:**
- Modify: `src/app/admin/(protected)/tenants/[id]/page.tsx`
- Create: `src/components/admin/tenant-delete-section.tsx`

**Interfaces:**
- Consumes: `TenantDeleteDialog` (Task 9), `POST /api/admin/tenants/[id]/delete` (Task 6).

- [ ] **Step 1: Create the client component that owns the delete button + dialog + submit logic**

Create `src/components/admin/tenant-delete-section.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TenantDeleteDialog, type TenantDeleteSummary } from "@/components/admin/tenant-delete-dialog";

export function TenantDeleteSection({ tenantId, summary }: { tenantId: string; summary: TenantDeleteSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}/delete`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Something went wrong");
        setDeleting(false);
        return;
      }
      router.push("/admin/tenants");
    } catch {
      setError("Something went wrong");
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <h2 className="mb-1 text-sm font-bold text-red-900">Danger Zone</h2>
      <p className="mb-3 text-xs text-red-700">
        Permanently delete this client and everything under them, after archiving a full export.
      </p>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete Client
      </Button>
      <TenantDeleteDialog
        open={open}
        onOpenChange={setOpen}
        tenant={summary}
        deleting={deleting}
        error={error}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the tenant detail page**

In `src/app/admin/(protected)/tenants/[id]/page.tsx`, add the summary counts to the existing `prisma.tenant.findUnique` select, and render the new section. Modify the `select` block to add:

```ts
      documents: { select: { type: true, createdAt: true } },
      customers: { select: { id: true } },
      products: { select: { id: true } },
```

Add the import:

```ts
import { TenantDeleteSection } from "@/components/admin/tenant-delete-section";
```

Compute the summary just before the `return` statement:

```ts
  const receiptCount = tenant.documents.filter((d) => d.type === "SALES_RECEIPT").length;
  const quotationCount = tenant.documents.filter((d) => d.type === "QUOTATION").length;
  const latestDocumentAt = tenant.documents.length
    ? tenant.documents.reduce((latest, d) => (d.createdAt > latest ? d.createdAt : latest), tenant.documents[0].createdAt)
    : null;
```

Render `<TenantDeleteSection>` at the bottom of the existing returned JSX, inside the outermost `<div>`, after the existing grid of forms:

```tsx
      <div className="mt-6">
        <TenantDeleteSection
          tenantId={tenant.id}
          summary={{
            tradeNameEn: tenant.tradeNameEn,
            receiptCount,
            quotationCount,
            customerCount: tenant.customers.length,
            productCount: tenant.products.length,
            latestDocumentAt: latestDocumentAt ? latestDocumentAt.toISOString() : null,
          }}
        />
      </div>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/\(protected\)/tenants/\[id\]/page.tsx src/components/admin/tenant-delete-section.tsx
git commit -m "Wire the Delete Client action into the tenant detail page"
```

---

### Task 11: Deleted clients list page

**Files:**
- Create: `src/app/admin/(protected)/tenants/deleted/page.tsx`
- Create: `src/components/admin/deleted-tenants-list.tsx`
- Modify: `src/app/admin/(protected)/tenants/page.tsx`

**Interfaces:**
- Consumes: `TenantArchive` (Task 1) directly via a server-component Prisma query — matching this codebase's existing pattern where `/admin/tenants/page.tsx` queries Prisma directly for its initial render rather than calling its own API route. `GET /api/admin/tenants/archived` (Task 7) is not called by this page; it remains standalone API surface satisfying spec §6, exercised only by Task 7's own tests.

- [ ] **Step 1: Create the list component**

Create `src/components/admin/deleted-tenants-list.tsx`:

```tsx
"use client";

import Link from "next/link";

export interface ArchivedTenantRow {
  id: string;
  tradeNameEn: string;
  legalName: string;
  vatNumber: string;
  joinedAt: string;
  deletedAt: string;
  receiptCount: number;
  quotationCount: number;
}

export function DeletedTenantsList({ archives }: { archives: ArchivedTenantRow[] }) {
  if (archives.length === 0) {
    return <p className="py-10 text-center text-xs text-neutral-400">No clients have been deleted.</p>;
  }

  return (
    <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {archives.map((a) => (
        <li key={a.id}>
          <Link href={`/admin/tenants/deleted/${a.id}`} className="block px-4 py-3 hover:bg-neutral-50">
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-neutral-900">{a.tradeNameEn}</div>
                <div className="truncate text-[12px] text-neutral-400">{a.legalName}</div>
              </div>
              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
                Deleted
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-neutral-500">
              <span className="font-mono">{a.vatNumber}</span>
              <span>
                {a.receiptCount} receipt{a.receiptCount === 1 ? "" : "s"}, {a.quotationCount} quotation
                {a.quotationCount === 1 ? "" : "s"}
              </span>
              <span className="text-neutral-400">Deleted {new Date(a.deletedAt).toLocaleDateString()}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Create the page**

Create `src/app/admin/(protected)/tenants/deleted/page.tsx`:

```tsx
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { DeletedTenantsList } from "@/components/admin/deleted-tenants-list";

export default async function DeletedTenantsPage() {
  const archives = await prisma.tenantArchive.findMany({
    select: { id: true, tradeNameEn: true, legalName: true, vatNumber: true, joinedAt: true, deletedAt: true, receiptCount: true, quotationCount: true },
    orderBy: { deletedAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-7 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Deleted Clients</h1>
          <p className="text-sm text-neutral-500">Archived clients whose data has been removed from the live database</p>
        </div>
        <Link href="/admin/tenants" className="text-[13px] font-semibold text-green-800 hover:text-green-700">
          ← Back to Clients
        </Link>
      </div>

      <DeletedTenantsList
        archives={archives.map((a) => ({
          ...a,
          joinedAt: a.joinedAt.toISOString(),
          deletedAt: a.deletedAt.toISOString(),
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 3: Link to it from the active tenants list**

In `src/app/admin/(protected)/tenants/page.tsx`, add a link next to the existing "+ New Client" link:

```tsx
        <Link
          href="/admin/tenants/deleted"
          className="self-start text-[13px] font-semibold text-neutral-500 hover:text-neutral-700 sm:self-auto"
        >
          View Deleted Clients
        </Link>
```

(placed as a sibling of the existing `<Link href="/admin/tenants/new" ...>`, inside the same flex container)

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add "src/app/admin/(protected)/tenants/deleted" "src/components/admin/deleted-tenants-list.tsx" "src/app/admin/(protected)/tenants/page.tsx"
git commit -m "Add the Deleted Clients list page"
```

---

### Task 12: Tombstone detail page with download

**Files:**
- Create: `src/app/admin/(protected)/tenants/deleted/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/tenants/archived/[id]/download` (Task 7).

- [ ] **Step 1: Create the page**

Create `src/app/admin/(protected)/tenants/deleted/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";

export default async function DeletedTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const archive = await prisma.tenantArchive.findUnique({
    where: { id },
    include: { deletedByAgencyStaff: { select: { email: true } } },
  });

  if (!archive) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-7 sm:py-8">
      <Link
        href="/admin/tenants/deleted"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-500 hover:text-green-800"
      >
        ← Back to Deleted Clients
      </Link>

      <h1 className="mb-1 text-xl font-bold text-neutral-900">{archive.tradeNameEn}</h1>
      <p className="mb-6 text-sm text-neutral-500">{archive.legalName}</p>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">VAT Number</div>
          <div className="font-mono text-neutral-900">{archive.vatNumber}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">CR Number</div>
          <div className="text-neutral-900">{archive.crNumber ?? "—"}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Joined</div>
          <div className="text-neutral-900">{archive.joinedAt.toLocaleDateString()}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Deleted</div>
          <div className="text-neutral-900">{archive.deletedAt.toLocaleDateString()}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Deleted By</div>
          <div className="text-neutral-900">{archive.deletedByAgencyStaff.email}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Records</div>
          <div className="text-neutral-900">
            {archive.receiptCount} receipts, {archive.quotationCount} quotations
          </div>
        </div>
      </div>

      <a
        href={`/api/admin/tenants/archived/${archive.id}/download`}
        className="mt-6 inline-flex items-center rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700"
      >
        Download Full Archive
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/(protected)/tenants/deleted/[id]"
git commit -m "Add the deleted-tenant tombstone detail page with archive download"
```

---

### Task 13: End-to-end manual verification

No new files — this confirms Tasks 1-12 work together against a real Vercel Blob store, which no automated test in this plan can fully exercise without `BLOB_READ_WRITE_TOKEN` configured.

- [ ] **Step 1: Confirm Vercel Blob is enabled**

If not already done: in the Vercel dashboard for this project, Storage tab → Create Database → Blob. Copy the resulting `BLOB_READ_WRITE_TOKEN` into `.env.local` for local testing, and confirm it's also set as a production environment variable in Vercel's project settings (needed before this feature can be used against the real deployment).

- [ ] **Step 2: Run the full test suite with the token set**

Run: `npx vitest run`
Expected: every test in this plan that was conditionally skipped in earlier tasks now runs and passes, with zero regressions in the rest of the suite.

- [ ] **Step 3: Build and run the production app**

Run: `npm run build && npm run start`

- [ ] **Step 4: Create a disposable test tenant with real data**

Using the browser tools: log in to `/admin`, create a new test tenant, log in as that tenant, create a product, a customer, and one Sales Receipt.

- [ ] **Step 5: Delete it and verify the full flow**

Back in the admin panel, open the test tenant, click Delete Client, confirm the summary counts match what was created, type the exact trade name, confirm. Verify:
- The response succeeds and redirects to the clients list.
- The tenant no longer appears in the active clients list.
- It now appears in "Deleted Clients", with the correct receipt count.
- Opening its detail page and clicking "Download Full Archive" downloads a real zip file.
- Unzip it and confirm: `manifest.json` and `data.json` are both present and correct, and the receipt's PDF in `receipts/1.pdf` actually opens and shows the same data the live receipt did.

- [ ] **Step 6: Verify the DEVELOPER-role restriction live**

Log in as a `DEVELOPER`-role staff member (or temporarily change an existing one's role in the database for this check), confirm the Delete Client button and the delete route are both inaccessible.

- [ ] **Step 7: Verify VAT-number rejoin detection live**

Create a new tenant using the same VAT number as the just-deleted test tenant, confirm the "previously deleted" notice appears with a working link to the tombstone.

- [ ] **Step 8: Report results**

Summarize what was verified back to the user. This task has no commit of its own.
