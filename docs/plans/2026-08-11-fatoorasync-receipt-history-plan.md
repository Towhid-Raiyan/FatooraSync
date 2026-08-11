# Receipt History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Receipt History" page — a paginated, searchable list of a tenant's past sales receipts, each viewable (existing print page) or downloadable as a real PDF file.

**Architecture:** A new `GET /api/receipts` endpoint adds server-side pagination/search/date-filtering to the existing receipts route. A new `GET /api/receipts/[id]/pdf` endpoint renders a receipt to a PDF buffer with `@react-pdf/renderer` and streams it as a direct download. A new `/receipts` page (Server Component + Client Component, same split as Customers/Products) drives both.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma, `@react-pdf/renderer` for PDF generation, `@expo-google-fonts/ibm-plex-sans-arabic` as the vendored Arabic font source (ships real `.ttf` files under `node_modules`, unlike `@fontsource`'s package for this font which only ships woff/woff2 — confirmed by inspecting both packages' file listings during planning; react-pdf's own docs state only TTF and WOFF are supported, and separately that WOFF2 causes rendering problems in practice, so TTF is the reliable choice here).

## Global Constraints

- `type: "SALES_RECEIPT"` is a permanent, explicit filter on every query in this plan — never a stand-in for "no other type exists yet." Quotation History is out of scope and gets its own endpoint later.
- Every tenant-scoped query in this plan uses `withTenant()`, following the established convention (`src/app/api/customers/route.ts`'s `GET`) — do **not** manually add `tenantId` to any `where` clause passed through `withTenant()`; the extension injects it, and a caller-supplied value would just be redundant, per the extension's own documented override behavior in `src/lib/db/tenant-context.ts`.
- Decimal fields (`grandTotal`) must be serialized to strings before crossing the Server → Client Component boundary or before being sent as JSON from an API route — same rule as every prior cycle in this project.
- Page size for the list endpoint is fixed at `10` server-side, not client-configurable — matches the design review's approved mockup exactly; do not add a `pageSize` query parameter.
- No changes to the existing print page (`src/app/(app)/receipts/[id]/print/page.tsx`) or the existing `POST /api/receipts` handler in this plan.

---

## Task 1: `GET /api/receipts` — paginated, searchable list

**Files:**
- Modify: `src/app/api/receipts/route.ts`
- Modify: `src/app/api/receipts/route.test.ts`

**Interfaces:**
- Produces: `GET /api/receipts?page=&search=&dateFrom=&dateTo=` → `200 { receipts: SerializedReceiptRow[], total: number, page: number, pageSize: number }` where `SerializedReceiptRow = { id: string, number: number, customerName: string, customerVatId: string | null, createdAt: string, grandTotal: string }`. `401` if unauthenticated.
- Consumes: `withTenant` from `@/lib/db/tenant-context` (already imported in this file for other tests, not yet in `route.ts` itself — this task adds the import to `route.ts`).

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `src/app/api/receipts/route.test.ts`, before the final closing `});` of the outer `describe("/api/receipts", ...)`:

```ts
describe("GET /api/receipts", () => {
  let historyTenantId: string;
  let historyCustomerId: string;
  let historyProductId: string;
  const createdReceiptIds: string[] = [];

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "History Test Co", tradeNameEn: "History Test Shop", vatNumber: "300000000000440" },
    });
    historyTenantId = tenant.id;
    await prisma.settings.create({ data: { tenantId: historyTenantId, defaultVatRate: 15 } });
    await withTenant(historyTenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const customer = await withTenant(historyTenantId, (tx) =>
      tx.customer.create({
        data: { name: "History Customer", vatId: "300000000000457" } as Prisma.CustomerUncheckedCreateInput,
      })
    );
    historyCustomerId = customer.id;
    const product = await withTenant(historyTenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "History Product", unitPrice: 10, quantity: 1000 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    historyProductId = product.id;

    mockSession = { user: { tenantId: historyTenantId } };
    // 15 receipts for historyCustomerId, backdated one day apart, oldest first
    for (let i = 0; i < 15; i++) {
      const res = await POST(
        postRequest({
          customer: { name: "History Customer", vatId: "300000000000457" },
          lines: [{ productId: historyProductId, quantity: "1" }],
        })
      );
      const body = await res.json();
      createdReceiptIds.push(body.id);
      const backdated = new Date(Date.now() - (15 - i) * 24 * 60 * 60 * 1000);
      await prisma.document.update({ where: { id: body.id }, data: { createdAt: backdated } });
    }
    mockSession = { user: { tenantId } };
  }, 60000);

  afterAll(async () => {
    await prisma.documentLine.deleteMany({ where: { tenantId: historyTenantId } });
    await prisma.document.deleteMany({ where: { tenantId: historyTenantId } });
    await prisma.customer.deleteMany({ where: { tenantId: historyTenantId } });
    await prisma.product.deleteMany({ where: { tenantId: historyTenantId } });
    await prisma.settings.deleteMany({ where: { tenantId: historyTenantId } });
    await prisma.tenant.delete({ where: { id: historyTenantId } });
  });

  function historyRequest(query: string) {
    return new Request(`http://localhost/api/receipts${query}`);
  }

  it("returns the first page (10 rows) newest-first, with the true total", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: historyTenantId } };
    try {
      const response = await GET(historyRequest(""));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.receipts).toHaveLength(10);
      expect(body.total).toBe(15);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(10);
      // newest-first: the last-created receipt (index 14, most recently backdated) leads
      expect(body.receipts[0].id).toBe(createdReceiptIds[14]);
      expect(body.receipts[9].id).toBe(createdReceiptIds[5]);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("returns the second page with the remaining rows", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: historyTenantId } };
    try {
      const response = await GET(historyRequest("?page=2"));
      const body = await response.json();
      expect(body.receipts).toHaveLength(5);
      expect(body.total).toBe(15);
      expect(body.receipts[4].id).toBe(createdReceiptIds[0]);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("returns an empty page (not an error) for a page number past the end", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: historyTenantId } };
    try {
      const response = await GET(historyRequest("?page=99"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.receipts).toEqual([]);
      expect(body.total).toBe(15);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("searches by exact receipt number", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: historyTenantId } };
    try {
      const first = await GET(historyRequest(""));
      const firstBody = await first.json();
      const targetNumber = firstBody.receipts[0].number;
      const response = await GET(historyRequest(`?search=${targetNumber}`));
      const body = await response.json();
      expect(body.receipts.every((r: { number: number }) => r.number === targetNumber)).toBe(true);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("searches by customer name substring, case-insensitively", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: historyTenantId } };
    try {
      const response = await GET(historyRequest("?search=history cust"));
      const body = await response.json();
      expect(body.total).toBe(15);
      expect(body.receipts.every((r: { customerName: string }) => r.customerName === "History Customer")).toBe(true);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("searches by VAT ID substring", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: historyTenantId } };
    try {
      const response = await GET(historyRequest("?search=000457"));
      const body = await response.json();
      expect(body.total).toBe(15);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("returns an empty result for a search matching neither a number nor any customer", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: historyTenantId } };
    try {
      const response = await GET(historyRequest("?search=zzz-no-match-zzz"));
      const body = await response.json();
      expect(body.total).toBe(0);
      expect(body.receipts).toEqual([]);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("filters by date range inclusively, excluding just outside either end", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: historyTenantId } };
    try {
      // receipt index 10 was backdated to (today - 5 days); index 9 to (today - 6 days)
      const targetDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const response = await GET(historyRequest(`?dateFrom=${targetDate}&dateTo=${targetDate}`));
      const body = await response.json();
      expect(body.total).toBe(1);
      expect(body.receipts[0].id).toBe(createdReceiptIds[10]);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("never returns another tenant's receipts, even when a search term matches their customer", { timeout: 30000 }, async () => {
    // tenantId's own beforeAll created a "Fresh Customer" earlier in this file;
    // searching for it while scoped to historyTenantId must find nothing
    mockSession = { user: { tenantId: historyTenantId } };
    try {
      const response = await GET(historyRequest("?search=Fresh Customer"));
      const body = await response.json();
      expect(body.total).toBe(0);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await GET(historyRequest(""));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
```

Also update the top-of-file import to include `GET` alongside `POST`:

```ts
import { GET, POST } from "./route";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/receipts/route.test.ts`
Expected: fails to compile / fails at runtime — `GET` is not exported from `./route` yet.

- [ ] **Step 3: Implement the GET handler**

In `src/app/api/receipts/route.ts`, add this import alongside the existing ones at the top of the file:

```ts
import { withTenant } from "@/lib/db/tenant-context";
```

Then add the following **after** the existing `POST` function (at the end of the file):

```ts
const PAGE_SIZE = 10;

function parseDateOrNull(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;

  const url = new URL(request.url);
  const pageParam = Number(url.searchParams.get("page"));
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;

  const search = url.searchParams.get("search")?.trim() || "";
  const startOfDay = parseDateOrNull(url.searchParams.get("dateFrom"));
  const endOfDay = parseDateOrNull(url.searchParams.get("dateTo"));
  if (endOfDay) {
    endOfDay.setHours(23, 59, 59, 999);
  }

  // `tenantId` is deliberately absent from this `where` -- withTenant() injects it
  // on every query it runs, and a caller-supplied value here would just be
  // redundant with (and silently overridden by) that injection. See the
  // Global Constraints note in this plan and tenant-context.ts's own comment.
  const where: Prisma.DocumentWhereInput = {
    type: "SALES_RECEIPT",
  };
  if (startOfDay || endOfDay) {
    where.createdAt = {
      ...(startOfDay ? { gte: startOfDay } : {}),
      ...(endOfDay ? { lte: endOfDay } : {}),
    };
  }
  if (search) {
    const strippedHash = search.startsWith("#") ? search.slice(1) : search;
    const parsedNumber = /^\d+$/.test(strippedHash) ? Number(strippedHash) : null;
    where.OR = [
      ...(parsedNumber !== null ? [{ number: parsedNumber }] : []),
      { customer: { name: { contains: search, mode: "insensitive" } } },
      { customer: { vatId: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [total, documents] = await withTenant(tenantId, (txn) =>
    Promise.all([
      txn.document.count({ where }),
      txn.document.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          number: true,
          grandTotal: true,
          createdAt: true,
          customer: { select: { name: true, vatId: true } },
        },
      }),
    ])
  );

  const receipts = documents.map((doc) => ({
    id: doc.id,
    number: doc.number,
    customerName: doc.customer.name,
    customerVatId: doc.customer.vatId,
    createdAt: doc.createdAt.toISOString(),
    grandTotal: doc.grandTotal.toString(),
  }));

  return NextResponse.json({ receipts, total, page, pageSize: PAGE_SIZE });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/receipts/route.test.ts`
Expected: all tests pass, including the new `GET /api/receipts` block and every pre-existing `POST` test (unaffected by this change).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/receipts/route.ts src/app/api/receipts/route.test.ts
git commit -m "Add paginated, searchable GET /api/receipts for Receipt History"
```

---

## Task 2: PDF generation — template, vendored Arabic font, download route

**Files:**
- Modify: `package.json` (add `@react-pdf/renderer` and `@expo-google-fonts/ibm-plex-sans-arabic`)
- Create: `src/lib/receipts/receipt-pdf.tsx`
- Create: `src/app/api/receipts/[id]/pdf/route.ts`
- Create: `src/app/api/receipts/[id]/pdf/route.test.ts`

**Interfaces:**
- Consumes: `computeInvoiceHash`/`buildZatcaQrPayload` are NOT needed here (the QR code is already stored on `Document.qrCode` from save time — this route reads it, it doesn't recompute it). Needs the `qrcode` package's `QRCode.toDataURL`, already a dependency (used in `print/page.tsx`).
- Produces: `GET /api/receipts/[id]/pdf` → `200`, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="receipt-<number>.pdf"`, non-empty binary body. `404` for a nonexistent id, a cross-tenant id, or a non-`SALES_RECEIPT` document. `401` if unauthenticated.
- Produces: `ReceiptPdfDocument` component from `src/lib/receipts/receipt-pdf.tsx`, taking `{ tenant, document, qrImageDataUrl }` where `document` includes `lines` and `customer` (matching the shape `print/page.tsx` already fetches).

- [ ] **Step 1: Install dependencies**

```bash
npm install @react-pdf/renderer @expo-google-fonts/ibm-plex-sans-arabic
```

- [ ] **Step 2: Write the PDF template**

Create `src/lib/receipts/receipt-pdf.tsx`:

```tsx
import path from "path";
import { Document, Page, View, Text, Image, Font, StyleSheet } from "@react-pdf/renderer";
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";

// @react-pdf/renderer only reliably supports TTF/OTF (its own docs: "only TTF and
// WOFF fonts files are supported", and WOFF2 is documented to cause rendering
// problems in practice) -- so the font source has to actually ship .ttf files.
// @fontsource/ibm-plex-sans-arabic (the package already used for on-screen
// rendering via next/font) only ships woff/woff2 for this specific font; this
// Expo-maintained package ships the same IBM Plex Sans Arabic typeface as plain
// .ttf files, which is what makes it usable here.
const FONT_DIR = path.join(
  process.cwd(),
  "node_modules/@expo-google-fonts/ibm-plex-sans-arabic"
);
Font.register({
  family: "IBM Plex Sans Arabic",
  fonts: [
    { src: path.join(FONT_DIR, "400Regular/IBMPlexSansArabic_400Regular.ttf"), fontWeight: "normal" },
    { src: path.join(FONT_DIR, "700Bold/IBMPlexSansArabic_700Bold.ttf"), fontWeight: "bold" },
  ],
});

const styles = StyleSheet.create({
  page: {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 9,
    color: "#000000",
    padding: 24,
  },
  center: { textAlign: "center", marginBottom: 12 },
  tradeNameAr: { fontSize: 13, fontWeight: "bold" },
  tradeNameEn: { fontSize: 11 },
  legalLine: { fontSize: 8, marginTop: 2 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", fontSize: 8, marginBottom: 8 },
  customerBlock: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#000000",
    paddingVertical: 6,
    fontSize: 8,
    marginBottom: 8,
  },
  table: { display: "flex", width: "100%" },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#000000",
    paddingBottom: 3,
    marginBottom: 3,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#CCCCCC",
    paddingVertical: 3,
  },
  colItem: { width: "34%", fontSize: 8 },
  colNum: { width: "16.5%", fontSize: 8, textAlign: "right" },
  headerCell: { fontSize: 7, fontWeight: "bold" },
  totalsBlock: { marginTop: 8, fontSize: 9 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  grandTotalRow: { flexDirection: "row", justifyContent: "space-between", fontSize: 11, fontWeight: "bold", marginTop: 4 },
  notes: { marginTop: 8, fontSize: 8 },
  qr: { width: 100, height: 100, alignSelf: "center", marginTop: 12 },
});

function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

type ReceiptDocument = PrismaDocument & {
  customer: Customer;
  lines: DocumentLine[];
};

export interface ReceiptPdfProps {
  tenant: Tenant;
  document: ReceiptDocument;
  qrImageDataUrl: string | null;
}

export function ReceiptPdfDocument({ tenant, document, qrImageDataUrl }: ReceiptPdfProps) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);

  return (
    <Document>
      <Page size="A6" style={styles.page}>
        <View style={styles.center}>
          <Text style={styles.tradeNameAr}>{tenant.tradeNameAr ?? tenant.tradeNameEn}</Text>
          <Text style={styles.tradeNameEn}>{tenant.tradeNameEn}</Text>
          <Text style={styles.legalLine}>
            {tenant.legalName} — VAT {tenant.vatNumber}
          </Text>
          {tenant.address && <Text style={styles.legalLine}>{tenant.address}</Text>}
        </View>

        <View style={styles.metaRow}>
          <Text>فاتورة ضريبية مبسطة / Simplified Tax Invoice #{document.number}</Text>
          <Text>{document.createdAt.toISOString().slice(0, 19).replace("T", " ")}</Text>
        </View>

        <View style={styles.customerBlock}>
          <Text>العميل / Customer: {document.customer.name}</Text>
          {document.customer.vatId && <Text>VAT ID: {document.customer.vatId}</Text>}
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.colItem, styles.headerCell]}>المنتج / Item</Text>
            <Text style={[styles.colNum, styles.headerCell]}>Qty</Text>
            <Text style={[styles.colNum, styles.headerCell]}>Price</Text>
            {hasDiscount && <Text style={[styles.colNum, styles.headerCell]}>Disc.</Text>}
            <Text style={[styles.colNum, styles.headerCell]}>VAT</Text>
            <Text style={[styles.colNum, styles.headerCell]}>Total</Text>
          </View>
          {document.lines.map((line) => (
            <View key={line.id} style={styles.tableRow}>
              <Text style={styles.colItem}>{line.productName}</Text>
              <Text style={styles.colNum}>{line.quantity.toString()}</Text>
              <Text style={styles.colNum}>{money(line.unitPrice)}</Text>
              {hasDiscount && <Text style={styles.colNum}>{money(line.discount)}</Text>}
              <Text style={styles.colNum}>{money(line.lineVat)}</Text>
              <Text style={styles.colNum}>{money(line.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text>الإجمالي الفرعي / Subtotal</Text>
            <Text>{money(document.subtotal)} SAR</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>ضريبة القيمة المضافة / VAT Total</Text>
            <Text>{money(document.vatTotal)} SAR</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text>الإجمالي / Grand Total</Text>
            <Text>{money(document.grandTotal)} SAR</Text>
          </View>
        </View>

        {document.notes && <Text style={styles.notes}>Notes: {document.notes}</Text>}

        {qrImageDataUrl && <Image src={qrImageDataUrl} style={styles.qr} />}
      </Page>
    </Document>
  );
}
```

- [ ] **Step 3: Write the failing route tests**

Create `src/app/api/receipts/[id]/pdf/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { GET } from "./route";

let tenantId: string;
let otherTenantId: string;
let receiptId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("GET /api/receipts/[id]/pdf", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "PDF Test Co", tradeNameEn: "PDF Test Shop", tradeNameAr: "متجر بي دي إف", vatNumber: "300000000000488" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });
    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "PDF Product", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput })
    );

    const saveResponse = await createReceipt(
      new Request("http://localhost/api/receipts", {
        method: "POST",
        body: JSON.stringify({ customer: { name: "", vatId: "" }, lines: [{ productId: product.id, quantity: "1" }] }),
      })
    );
    const saved = await saveResponse.json();
    receiptId = saved.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "PDF Other Co", tradeNameEn: "PDF Other Shop", vatNumber: "300000000000495" },
    });
    otherTenantId = otherTenant.id;
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

  function pdfRequest() {
    return new Request(`http://localhost/api/receipts/${receiptId}/pdf`);
  }

  it("returns a non-empty PDF for a valid receipt", { timeout: 30000 }, async () => {
    const response = await GET(pdfRequest(), { params: Promise.resolve({ id: receiptId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
    // %PDF is the standard magic-bytes signature every valid PDF file starts with
    const magic = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 4));
    expect(magic).toBe("%PDF");
  }, 30000);

  it("returns 404 for a receipt belonging to another tenant", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: otherTenantId } };
    try {
      const response = await GET(pdfRequest(), { params: Promise.resolve({ id: receiptId }) });
      expect(response.status).toBe(404);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("returns 404 for a nonexistent id", { timeout: 30000 }, async () => {
    const response = await GET(
      new Request("http://localhost/api/receipts/00000000-0000-0000-0000-000000000000/pdf"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await GET(pdfRequest(), { params: Promise.resolve({ id: receiptId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run "src/app/api/receipts/[id]/pdf/route.test.ts"`
Expected: fails — the route file doesn't exist yet.

- [ ] **Step 5: Implement the PDF route**

Create `src/app/api/receipts/[id]/pdf/route.ts`:

```ts
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { ReceiptPdfDocument } from "@/lib/receipts/receipt-pdf";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const { id } = await params;

  const document = await withTenant(tenantId, (tx) =>
    tx.document.findFirst({
      where: { id, type: "SALES_RECEIPT" },
      include: { lines: true, customer: true },
    })
  );
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const qrImageDataUrl = document.qrCode ? await QRCode.toDataURL(document.qrCode) : null;

  const buffer = await renderToBuffer(
    <ReceiptPdfDocument tenant={tenant} document={document} qrImageDataUrl={qrImageDataUrl} />
  );

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${document.number}.pdf"`,
    },
  });
}
```

Note: this file needs a `.tsx` extension (not `.ts`) since it contains JSX (`<ReceiptPdfDocument ... />`). Create it as `src/app/api/receipts/[id]/pdf/route.tsx` and update Step 3/4's test commands and the test file's own relative import (`from "./route"`) accordingly — Next.js route handlers work identically regardless of `.ts` vs `.tsx`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run "src/app/api/receipts/[id]/pdf/route.test.ts"`
Expected: all four tests pass.

- [ ] **Step 7: Manually verify Arabic rendering — this is the step that actually resolves the risk flagged in the design spec**

This cannot be fully verified by the automated tests above (they check the PDF's headers and magic bytes, not its rendered content). Generate a real PDF and look at it:

1. Start the dev server, log in, create a receipt for a tenant whose `tradeNameAr` is set (the seeded demo tenant has one — "متجر تجريبي").
2. Request `/api/receipts/<that receipt's id>/pdf` directly in a browser tab (or via the history page once Task 3 is done) and open the downloaded file.
3. Confirm the Arabic trade name and the bilingual labels ("فاتورة ضريبية مبسطة / Simplified Tax Invoice", "العميل / Customer", etc.) render as legible, correctly-shaped Arabic text — not boxes/tofu, not disconnected letter forms, not reversed character order.

If it doesn't render acceptably: this is exactly the finding the design spec (§7) said to bring back for a decision rather than silently work around. Report what was actually observed (tofu boxes vs. wrong shaping vs. wrong direction are different problems with different fixes) before changing the template.

- [ ] **Step 8: Typecheck, lint, and full test suite**

Run: `npx tsc --noEmit`, `npm run lint`, `npm test`
Expected: all clean; the full suite (not just this task's new files) still passes.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/lib/receipts/receipt-pdf.tsx "src/app/api/receipts/[id]/pdf"
git commit -m "Add direct PDF download for a saved receipt"
```

---

## Task 3: Frontend — Receipt History page

**Files:**
- Create: `src/app/(app)/receipts/page.tsx`
- Create: `src/components/receipts/receipt-history-client.tsx`
- Modify: `src/components/shell/nav-items.ts`

**Interfaces:**
- Consumes: `GET /api/receipts` (Task 1) — `{ receipts: SerializedReceiptRow[], total, page, pageSize }`. `GET /api/receipts/[id]/pdf` (Task 2) — linked directly, not fetched via JS.
- Produces: page at `/receipts`.

- [ ] **Step 1: Update the nav item**

In `src/components/shell/nav-items.ts`, change:

```ts
{ label: "History", href: null },
```

to:

```ts
{ label: "Receipt History", href: "/receipts" },
```

- [ ] **Step 2: Build the Client Component**

Create `src/components/receipts/receipt-history-client.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface ReceiptRow {
  id: string;
  number: number;
  customerName: string;
  customerVatId: string | null;
  createdAt: string;
  grandTotal: string;
}

interface ReceiptsResponse {
  receipts: ReceiptRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY: ReceiptsResponse = { receipts: [], total: 0, page: 1, pageSize: 10 };

export function ReceiptHistoryClient({ initial }: { initial: ReceiptsResponse }) {
  const [data, setData] = useState<ReceiptsResponse>(initial);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRun = useRef(true);

  async function fetchPage(targetPage: number) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (search.trim()) params.set("search", search.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await fetch(`/api/receipts?${params.toString()}`);
      if (!response.ok) {
        setError("Something went wrong loading receipts");
        setData(EMPTY);
        return;
      }
      const body: ReceiptsResponse = await response.json();
      setData(body);
    } catch {
      setError("Something went wrong loading receipts");
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }

  // Debounced re-fetch on search/date change -- resets to page 1, since the
  // previous page number may no longer make sense against a new filter's
  // result set. Skipped on first mount: the server already provided page 1
  // with no filters via the initial prop, so an immediate re-fetch here would
  // just be a redundant duplicate of that same request.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo]);

  function goToPage(targetPage: number) {
    setPage(targetPage);
    fetchPage(targetPage);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Receipt #, customer name, or VAT ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        <span className="text-sm text-muted-fg">to</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {data.total === 0 && !loading ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">
              {search || dateFrom || dateTo ? "No matching receipts" : "No receipts yet — create your first one"}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-fg">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : (
                data.receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.number}</TableCell>
                    <TableCell>
                      <div className="font-medium text-heading">{r.customerName}</div>
                      {r.customerVatId && <div className="text-xs text-muted-fg">{r.customerVatId}</div>}
                    </TableCell>
                    <TableCell>{r.createdAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-right font-semibold text-heading">
                      {Number(r.grandTotal).toFixed(2)} SAR
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/receipts/${r.id}/print`}>View</Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/api/receipts/${r.id}/pdf`}>Download</a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-fg">
          <span>
            {data.total} total match{data.total === 1 ? "" : "es"}
          </span>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>
              ← Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => goToPage(page + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build the Server Component page**

Create `src/app/(app)/receipts/page.tsx`:

```tsx
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { ReceiptHistoryClient } from "@/components/receipts/receipt-history-client";

const PAGE_SIZE = 10;

export default async function ReceiptHistoryPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const where = { type: "SALES_RECEIPT" as const };
  const [total, documents] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.count({ where }),
      tx.document.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE,
        select: {
          id: true,
          number: true,
          grandTotal: true,
          createdAt: true,
          customer: { select: { name: true, vatId: true } },
        },
      }),
    ])
  );

  const receipts = documents.map((doc) => ({
    id: doc.id,
    number: doc.number,
    customerName: doc.customer.name,
    customerVatId: doc.customer.vatId,
    createdAt: doc.createdAt.toISOString(),
    grandTotal: doc.grandTotal.toString(),
  }));

  return <ReceiptHistoryClient initial={{ receipts, total, page: 1, pageSize: PAGE_SIZE }} />;
}
```

This duplicates the query shape from Task 1's `GET` handler rather than calling it internally — consistent with how `customers/page.tsx` and `products/page.tsx` already query directly via `withTenant` for their initial server-rendered load rather than calling their own API routes.

- [ ] **Step 4: Manual browser verification**

Start the dev server and check, logged in as the seeded demo tenant:
1. Sidebar shows "Receipt History" (not "History") and it's clickable.
2. The page loads with the tenant's most recent 10 receipts, newest first.
3. Typing in the search box (receipt number, customer name, VAT ID) re-queries after a brief pause and shows a loading state.
4. Date range filters work the same way.
5. Previous/Next page correctly move through results and disable at the ends.
6. "View" opens the existing print page for that receipt.
7. "Download" downloads an actual `.pdf` file (not a navigation to a new tab) — confirm the browser's download, not a page navigation, is what happens.
8. Empty states: a search matching nothing shows "No matching receipts"; if a fresh tenant is used with zero receipts, "No receipts yet — create your first one".

- [ ] **Step 5: Typecheck, lint, full test suite, and production build**

Run: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/receipts/page.tsx src/components/receipts/receipt-history-client.tsx src/components/shell/nav-items.ts
git commit -m "Add the Receipt History page"
```

---

## Final whole-branch review

After all three tasks are complete and committed, dispatch a broad review of the entire branch diff (not just the last task) before finishing the branch — same rigor as every prior cycle in this project: tenant isolation on both new routes, the PDF route's 404-vs-401 handling, the pagination math (off-by-one on `skip`/`take`, `total` staying accurate across filters), and the Arabic-rendering verification from Task 2 Step 7 actually having been done and reported, not skipped.
