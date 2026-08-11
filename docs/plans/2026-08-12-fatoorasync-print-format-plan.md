# Print Format (Thermal / A4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each tenant choose, per Settings, whether printed/downloaded Receipts and Quotations use the existing thermal (A6) design or a new A4 design — without changing the existing thermal design at all.

**Architecture:** Add a `PrintFormat` enum to `Settings` and a `phone` field to `Tenant`. Build shared, tested print-format infrastructure (a pagination pure function, a note-truncation helper, shared react-pdf components, shared browser-JSX components) once, then reuse it for both document types' new A4 templates — mirroring how this project already reuses `CustomerSection`/`ItemsSection` across Receipt and Quotation. Every print/PDF route branches on `Settings.printFormat` after its existing auth/tenant/404 checks, picking between the existing thermal component (untouched) and the new A4 component.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma, PostgreSQL, `@react-pdf/renderer`, `next/font/google`, Tailwind v4.

**Reference spec:** `docs/specs/2026-08-12-fatoorasync-print-format-design.md` — read this for the full rationale behind every decision below. This plan implements it exactly.

## Global Constraints

- `printFormat` lives on `Settings` (`@default(THERMAL)`), one shared value driving both Sales Receipt and Quotation — never a per-document-type override.
- `phone` lives on `Tenant`, not `Settings` — it's a business-profile fact alongside `legalName`/`tradeNameEn/Ar`/`vatNumber`/`crNumber`/`address`, not a preference.
- **No changes to any existing thermal file's rendered output.** `receipt-pdf.tsx`, `quotation-pdf.tsx`, and the two existing print pages' *visual output* must be byte-identical to today after this plan — the print pages get refactored (their JSX moves into new `*-print-thermal.tsx` components) but the refactor must not change what's rendered.
- The A4 item table's leading `#` serial-number column, the `#` numbering is 1-indexed across the *whole* document (continues correctly across a page break), never reset per page.
- Quotation's A4 template never renders a QR block — Quotation never has QR data, in either paper format. Only Receipt's A4 template takes a `qrImageDataUrl` prop.
- Any Tenant business-profile field (`crNumber`, `phone`, `address`) or Customer field (`vatId`, `crNumber`, `phone`, `address`) that isn't set is omitted from the A4 output entirely — never rendered as an empty label.
- Page-splitting for A4 (both the PDF and the browser print page) is computed server-side via the shared `paginateA4Items()` function — never left to organic reflow/pagination.
- Every tenant-scoped query uses `withTenant()` — never manually add `tenantId` to a `where` clause passed through it. `Tenant` itself is never accessed through `withTenant()` (it's the root, not a tenant-scoped model) — use `prisma.tenant.*` directly, exactly as the existing print/PDF routes and this plan's Task 2 already do.
- Decimal fields serialized to strings before crossing the Server → Client Component boundary or into a JSON API response.

---

### Task 1: Schema + shared print-format infrastructure

**Files:**
- Modify: `prisma/schema.prisma`
- Create: a new migration under `prisma/migrations/` (generated, not hand-written)
- Create: `src/lib/print-format/paginate-a4-items.ts`
- Test: `src/lib/print-format/paginate-a4-items.test.ts`
- Create: `src/lib/print-format/truncate-note.ts`
- Test: `src/lib/print-format/truncate-note.test.ts`
- Create: `src/lib/print-format/a4-fonts.ts`
- Create: `src/lib/print-format/a4-pdf-parts.tsx`
- Create: `src/components/print-format/a4-print-parts.tsx`

**Interfaces:**
- Produces: `PrintFormat` enum (`"THERMAL" | "A4"`) usable from `Settings.printFormat`; `Tenant.phone: string | null`; `paginateA4Items(itemCount: number): number[]`; `truncateNote(notes: string): string`; the shared react-pdf components `a4PdfStyles`, `A4BusinessHeader`, `A4BilledTo`, `A4ItemsTable`, `A4Totals`, `A4Footer`, `money`, and the type `A4Document` from `a4-pdf-parts.tsx`; the equivalent browser-JSX components from `a4-print-parts.tsx`. Tasks 2-6 all depend on these exact names/signatures.

- [ ] **Step 1: Add the schema fields**

In `prisma/schema.prisma`, add a new enum near `DocumentType`:

```prisma
enum PrintFormat {
  THERMAL
  A4
}
```

Add `phone` to `Tenant`, right after `address`:

```prisma
model Tenant {
  id                     String   @id @default(uuid())
  legalName              String
  tradeNameEn            String
  tradeNameAr            String?
  vatNumber              String
  crNumber               String?
  address                String?
  phone                  String?
  defaultLocale          String   @default("ar")
  createdAt              DateTime @default(now())
  nextProductSkuNumber   Int      @default(1)
  nextSalesReceiptNumber Int      @default(1)
  nextQuotationNumber    Int      @default(1)
  lastSalesReceiptHash   String?

  users         User[]
  settings      Settings?
  customers     Customer[]
  products      Product[]
  documents     Document[]
  documentLines DocumentLine[]
}
```

Add `printFormat` to `Settings`:

```prisma
model Settings {
  id             String      @id @default(uuid())
  tenantId       String      @unique
  tenant         Tenant      @relation(fields: [tenantId], references: [id])
  defaultVatRate Decimal     @default(15.00) @db.Decimal(5, 2)
  language       String      @default("ar")
  printFormat    PrintFormat @default(THERMAL)
}
```

- [ ] **Step 2: Generate and run the migration**

Run: `npx prisma migrate dev --name add_print_format_and_tenant_phone`
Expected: a new migration adding `"Tenant"."phone"` (nullable text) and `"Settings"."printFormat"` (the new enum type, `NOT NULL DEFAULT 'THERMAL'`), applied cleanly.

- [ ] **Step 3: Write the pagination pure function**

Create `src/lib/print-format/paginate-a4-items.ts`:

```ts
// How many line items land on each A4 page, for both Receipt and Quotation. Computed
// deliberately, not left to browser/PDF reflow, because the layout rules require
// specific placement: the "Billed To" block only appears on page 1, and the QR/note/
// totals/footer block only appears on the LAST page. These four numbers were derived
// from real row-height/margin math against A4 dimensions -- verify against an actual
// rendered page (browser + PDF) before treating them as final; if real rendering shows
// they're off, they're a one-line constant change here, not a layout rewrite.
export const SINGLE_PAGE_MAX_ITEMS = 14;  // page 1 also carries Billed To + QR/note/totals/footer
export const FIRST_PAGE_MAX_ITEMS = 20;   // multi-page mode: page 1 has Billed To but NOT QR/note/totals
export const MIDDLE_PAGE_MAX_ITEMS = 26;  // no Billed To, no QR/note/totals -- just header + items
export const LAST_PAGE_MAX_ITEMS = 16;    // no Billed To, but DOES carry QR/note/totals/footer

/**
 * Returns an ordered list of item-counts, one entry per page. A page can end up with
 * 0 items (e.g. exactly SINGLE_PAGE_MAX_ITEMS + 1 items -> [15, 0]): item 15 didn't
 * fit within the single-page budget, so a second page exists purely to carry the
 * totals/QR/note/footer block.
 */
export function paginateA4Items(itemCount: number): number[] {
  if (itemCount <= SINGLE_PAGE_MAX_ITEMS) return [itemCount];

  const pages: number[] = [];
  let remaining = itemCount;
  const firstPageCount = Math.min(remaining, FIRST_PAGE_MAX_ITEMS);
  pages.push(firstPageCount);
  remaining -= firstPageCount;

  while (remaining > LAST_PAGE_MAX_ITEMS) {
    const take = Math.min(remaining, MIDDLE_PAGE_MAX_ITEMS);
    pages.push(take);
    remaining -= take;
  }
  pages.push(remaining);
  return pages;
}
```

- [ ] **Step 4: Test the pagination function**

Create `src/lib/print-format/paginate-a4-items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { paginateA4Items } from "./paginate-a4-items";

describe("paginateA4Items", () => {
  it("returns a single page with 0 items", () => {
    expect(paginateA4Items(0)).toEqual([0]);
  });

  it("fits everything on one page at the single-page max (14)", () => {
    expect(paginateA4Items(14)).toEqual([14]);
  });

  it("goes multi-page one item over the single-page max, with an empty second page for totals", () => {
    expect(paginateA4Items(15)).toEqual([15, 0]);
  });

  it("fills page 1 up to its multi-page max (20) with nothing left over", () => {
    expect(paginateA4Items(20)).toEqual([20, 0]);
  });

  it("spills one item onto page 2 just past the first-page max", () => {
    expect(paginateA4Items(21)).toEqual([20, 1]);
  });

  it("fits exactly two pages at the first+last page capacity boundary (20 + 16 = 36)", () => {
    expect(paginateA4Items(36)).toEqual([20, 16]);
  });

  it("needs a third page one item past the two-page capacity boundary", () => {
    expect(paginateA4Items(37)).toEqual([20, 17, 0]);
  });

  it("splits a large order across a first, middle, and last page", () => {
    expect(paginateA4Items(60)).toEqual([20, 26, 14]);
  });

  it("every page's item count sums back to the original item count", () => {
    for (const count of [1, 13, 14, 15, 20, 21, 35, 36, 37, 60, 100]) {
      const pages = paginateA4Items(count);
      expect(pages.reduce((a, b) => a + b, 0)).toBe(count);
    }
  });
});
```

- [ ] **Step 5: Write the note-truncation helper**

Create `src/lib/print-format/truncate-note.ts`:

```ts
// The A4 note box is sized for roughly 2 lines / ~40 words. Rather than validating
// note length at save time (the field is shared with the thermal design, which has
// no such limit), truncate for display only -- long notes are still saved in full,
// just clipped in the A4 render so the fixed-height box never overlaps the totals
// block below it.
const MAX_NOTE_CHARS = 220;

export function truncateNote(notes: string): string {
  if (notes.length <= MAX_NOTE_CHARS) return notes;
  return notes.slice(0, MAX_NOTE_CHARS).trimEnd() + "…";
}
```

- [ ] **Step 6: Test the truncation helper**

Create `src/lib/print-format/truncate-note.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { truncateNote } from "./truncate-note";

describe("truncateNote", () => {
  it("returns short notes unchanged", () => {
    expect(truncateNote("Valid for 7 days.")).toBe("Valid for 7 days.");
  });

  it("returns a note exactly at the limit unchanged", () => {
    const exact = "a".repeat(220);
    expect(truncateNote(exact)).toBe(exact);
  });

  it("truncates a note past the limit and appends an ellipsis", () => {
    const long = "a".repeat(250);
    const result = truncateNote(long);
    expect(result.length).toBe(221); // 220 chars + "…"
    expect(result.endsWith("…")).toBe(true);
  });

  it("trims trailing whitespace before appending the ellipsis", () => {
    const long = "a".repeat(219) + "   more text that gets cut off";
    const result = truncateNote(long);
    expect(result.endsWith(" …")).toBe(false);
  });
});
```

- [ ] **Step 7: Write the shared A4 PDF font registration**

Create `src/lib/print-format/a4-fonts.ts`:

```ts
import path from "path";
import { Font } from "@react-pdf/renderer";

// Shared between the Receipt and Quotation A4 PDF templates -- both need the identical
// Prata + Inter registration. Same vendored-TTF reasoning as receipt-pdf.tsx's Arabic
// font comment: @react-pdf/renderer needs real .ttf files, and Google Fonts' own CSS
// delivery is woff/woff2. @expo-google-fonts/prata and @expo-google-fonts/inter both
// ship real .ttf files (confirmed via `npm pack --dry-run`), and both are OFL-1.1
// licensed -- free to embed in a commercial product.
const PRATA_DIR = path.join(process.cwd(), "node_modules/@expo-google-fonts/prata");
const INTER_DIR = path.join(process.cwd(), "node_modules/@expo-google-fonts/inter");

Font.register({
  family: "Prata",
  fonts: [{ src: path.join(PRATA_DIR, "400Regular/Prata_400Regular.ttf") }],
});
Font.register({
  family: "Inter",
  fonts: [
    { src: path.join(INTER_DIR, "400Regular/Inter_400Regular.ttf"), fontWeight: "normal" },
    { src: path.join(INTER_DIR, "600SemiBold/Inter_600SemiBold.ttf"), fontWeight: "bold" },
  ],
});
```

- [ ] **Step 8: Verify the font packages are installed**

Run: `npm install @expo-google-fonts/prata @expo-google-fonts/inter`
Then confirm the exact files this module expects actually exist:
`ls node_modules/@expo-google-fonts/prata/400Regular/Prata_400Regular.ttf node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf`
Expected: all three paths exist. If a path differs, fix `a4-fonts.ts` to match the real layout — do not guess.

- [ ] **Step 9: Write the shared react-pdf A4 components**

Create `src/lib/print-format/a4-pdf-parts.tsx`:

```tsx
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import "./a4-fonts";

export const a4PdfStyles = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, color: "#1a1a1a", padding: 32, backgroundColor: "#f7f5f0" },
  headerRow: { flexDirection: "row", justifyContent: "space-between" },
  bizNameAr: { fontSize: 13, fontWeight: "bold" },
  bizNameEn: { fontSize: 11, fontWeight: "bold" },
  bizLine: { fontSize: 8, color: "#555555", marginTop: 2 },
  docTitle: { fontFamily: "Prata", fontSize: 28, textAlign: "right" },
  meta: { fontSize: 8, color: "#555555", textAlign: "right", marginTop: 4 },
  hr: { borderBottomWidth: 1, borderColor: "#d8d4c8", marginVertical: 12 },
  billedLabel: { fontSize: 9, fontWeight: "bold", marginBottom: 6 },
  billedGrid: { flexDirection: "row", flexWrap: "wrap" },
  billedCell: { width: "50%", fontSize: 8, marginBottom: 4 },
  billedCellFull: { width: "100%", fontSize: 8, marginBottom: 4 },
  billedLbl: { color: "#888888" },
  table: { marginTop: 8 },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#1a1a1a",
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e8e5db", paddingVertical: 4 },
  colNum: { width: "6%", fontSize: 8 },
  colItem: { width: "34%", fontSize: 8 },
  colQty: { width: "12%", fontSize: 8, textAlign: "right" },
  colPrice: { width: "14%", fontSize: 8, textAlign: "right" },
  colVat: { width: "12%", fontSize: 8, textAlign: "right" },
  colTotal: { width: "16%", fontSize: 8, textAlign: "right" },
  colDiscount: { width: "12%", fontSize: 8, textAlign: "right" },
  headerCell: { fontSize: 7, fontWeight: "bold", textTransform: "uppercase", color: "#777777" },
  totalsBlock: { position: "absolute", bottom: 90, right: 32, width: 180 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3, fontSize: 9 },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderColor: "#1a1a1a",
    fontSize: 12,
    fontWeight: "bold",
  },
  qr: { position: "absolute", bottom: 90, left: 32, width: 64, height: 64 },
  note: {
    position: "absolute",
    bottom: 40,
    left: 32,
    right: 32,
    backgroundColor: "#eae7dd",
    padding: 8,
    borderRadius: 3,
    fontSize: 7.5,
    lineHeight: 1.4,
  },
  footer: { position: "absolute", bottom: 16, left: 0, right: 0, textAlign: "center", fontSize: 6.5, color: "#aaaaaa" },
});

export function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

export type A4Document = PrismaDocument & { customer: Customer; lines: DocumentLine[] };

export function A4BusinessHeader({
  tenant,
  document,
  docTitle,
  docNumberLabel,
}: {
  tenant: Tenant;
  document: A4Document;
  docTitle: string;
  docNumberLabel: string;
}) {
  return (
    <View style={a4PdfStyles.headerRow}>
      <View>
        <Text style={a4PdfStyles.bizNameAr}>{tenant.tradeNameAr ?? tenant.tradeNameEn}</Text>
        <Text style={a4PdfStyles.bizNameEn}>{tenant.tradeNameEn}</Text>
        <Text style={a4PdfStyles.bizLine}>VAT ID: {tenant.vatNumber}</Text>
        {tenant.crNumber && <Text style={a4PdfStyles.bizLine}>CR No: {tenant.crNumber}</Text>}
        {tenant.phone && <Text style={a4PdfStyles.bizLine}>Phone: {tenant.phone}</Text>}
        {tenant.address && <Text style={a4PdfStyles.bizLine}>{tenant.address}</Text>}
      </View>
      <View>
        <Text style={a4PdfStyles.docTitle}>{docTitle}</Text>
        <Text style={a4PdfStyles.meta}>
          {docNumberLabel} No. {document.number}
        </Text>
        <Text style={a4PdfStyles.meta}>{document.createdAt.toISOString().slice(0, 19).replace("T", " ")}</Text>
      </View>
    </View>
  );
}

export function A4BilledTo({ customer }: { customer: Customer }) {
  return (
    <View>
      <Text style={a4PdfStyles.billedLabel}>BILLED TO / إلى</Text>
      <View style={a4PdfStyles.billedGrid}>
        <View style={a4PdfStyles.billedCell}>
          <Text style={a4PdfStyles.billedLbl}>Name</Text>
          <Text>{customer.name}</Text>
        </View>
        {customer.vatId && (
          <View style={a4PdfStyles.billedCell}>
            <Text style={a4PdfStyles.billedLbl}>VAT ID</Text>
            <Text>{customer.vatId}</Text>
          </View>
        )}
        {customer.crNumber && (
          <View style={a4PdfStyles.billedCell}>
            <Text style={a4PdfStyles.billedLbl}>CR Number</Text>
            <Text>{customer.crNumber}</Text>
          </View>
        )}
        {customer.phone && (
          <View style={a4PdfStyles.billedCell}>
            <Text style={a4PdfStyles.billedLbl}>Phone</Text>
            <Text>{customer.phone}</Text>
          </View>
        )}
        {customer.address && (
          <View style={a4PdfStyles.billedCellFull}>
            <Text style={a4PdfStyles.billedLbl}>Address</Text>
            <Text>{customer.address}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function A4ItemsTable({
  lines,
  startIndex,
  hasDiscount,
}: {
  lines: DocumentLine[];
  startIndex: number;
  hasDiscount: boolean;
}) {
  return (
    <View style={a4PdfStyles.table}>
      <View style={a4PdfStyles.tableHeaderRow}>
        <Text style={[a4PdfStyles.colNum, a4PdfStyles.headerCell]}>#</Text>
        <Text style={[a4PdfStyles.colItem, a4PdfStyles.headerCell]}>Item</Text>
        <Text style={[a4PdfStyles.colQty, a4PdfStyles.headerCell]}>Qty</Text>
        <Text style={[a4PdfStyles.colPrice, a4PdfStyles.headerCell]}>Price</Text>
        {hasDiscount && <Text style={[a4PdfStyles.colDiscount, a4PdfStyles.headerCell]}>Disc.</Text>}
        <Text style={[a4PdfStyles.colVat, a4PdfStyles.headerCell]}>VAT</Text>
        <Text style={[a4PdfStyles.colTotal, a4PdfStyles.headerCell]}>Total</Text>
      </View>
      {lines.map((line, i) => (
        <View key={line.id} style={a4PdfStyles.tableRow}>
          <Text style={a4PdfStyles.colNum}>{startIndex + i + 1}</Text>
          <Text style={a4PdfStyles.colItem}>{line.productName}</Text>
          <Text style={a4PdfStyles.colQty}>{line.quantity.toString()}</Text>
          <Text style={a4PdfStyles.colPrice}>{money(line.unitPrice)}</Text>
          {hasDiscount && <Text style={a4PdfStyles.colDiscount}>{money(line.discount)}</Text>}
          <Text style={a4PdfStyles.colVat}>{money(line.lineVat)}</Text>
          <Text style={a4PdfStyles.colTotal}>{money(line.lineTotal)}</Text>
        </View>
      ))}
    </View>
  );
}

export function A4Totals({ document }: { document: A4Document }) {
  return (
    <View style={a4PdfStyles.totalsBlock}>
      <View style={a4PdfStyles.totalsRow}>
        <Text>Subtotal</Text>
        <Text>{money(document.subtotal)} SAR</Text>
      </View>
      <View style={a4PdfStyles.totalsRow}>
        <Text>Total VAT</Text>
        <Text>{money(document.vatTotal)} SAR</Text>
      </View>
      <View style={a4PdfStyles.grandTotalRow}>
        <Text>Total Payable</Text>
        <Text>{money(document.grandTotal)} SAR</Text>
      </View>
    </View>
  );
}

export function A4Footer() {
  return <Text style={a4PdfStyles.footer}>Powered By: FatooraSync</Text>;
}
```

- [ ] **Step 10: Write the shared browser (print page) A4 components**

Create `src/components/print-format/a4-print-parts.tsx`:

```tsx
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { truncateNote } from "@/lib/print-format/truncate-note";

export function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

export type A4Document = PrismaDocument & { customer: Customer; lines: DocumentLine[] };

export function A4BusinessHeader({
  tenant,
  document,
  docTitle,
  docNumberLabel,
  prataClassName,
}: {
  tenant: Tenant;
  document: A4Document;
  docTitle: string;
  docNumberLabel: string;
  prataClassName: string;
}) {
  return (
    <div className="flex justify-between">
      <div>
        <div className="text-[13px] font-bold">{tenant.tradeNameAr ?? tenant.tradeNameEn}</div>
        <div className="text-[11px] font-bold">{tenant.tradeNameEn}</div>
        <div className="mt-1 text-[8px] text-gray-600">VAT ID: {tenant.vatNumber}</div>
        {tenant.crNumber && <div className="text-[8px] text-gray-600">CR No: {tenant.crNumber}</div>}
        {tenant.phone && <div className="text-[8px] text-gray-600">Phone: {tenant.phone}</div>}
        {tenant.address && <div className="text-[8px] text-gray-600">{tenant.address}</div>}
      </div>
      <div className="text-right">
        <div className={`${prataClassName} text-[28px]`}>{docTitle}</div>
        <div className="mt-1 text-[8px] text-gray-600">
          {docNumberLabel} No. {document.number}
        </div>
        <div className="text-[8px] text-gray-600">{document.createdAt.toISOString().slice(0, 19).replace("T", " ")}</div>
      </div>
    </div>
  );
}

export function A4BilledTo({ customer }: { customer: Customer }) {
  return (
    <div>
      <div className="mb-1.5 text-[9px] font-bold">BILLED TO / إلى</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[8px]">
        <div>
          <span className="text-gray-500">Name</span>
          <br />
          {customer.name}
        </div>
        {customer.vatId && (
          <div>
            <span className="text-gray-500">VAT ID</span>
            <br />
            {customer.vatId}
          </div>
        )}
        {customer.crNumber && (
          <div>
            <span className="text-gray-500">CR Number</span>
            <br />
            {customer.crNumber}
          </div>
        )}
        {customer.phone && (
          <div>
            <span className="text-gray-500">Phone</span>
            <br />
            {customer.phone}
          </div>
        )}
        {customer.address && (
          <div className="col-span-2">
            <span className="text-gray-500">Address</span>
            <br />
            {customer.address}
          </div>
        )}
      </div>
    </div>
  );
}

export function A4ItemsTable({
  lines,
  startIndex,
  hasDiscount,
}: {
  lines: DocumentLine[];
  startIndex: number;
  hasDiscount: boolean;
}) {
  return (
    <table className="mt-3 w-full text-[8px]">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="py-1 text-[7px] uppercase text-gray-500">#</th>
          <th className="py-1 text-[7px] uppercase text-gray-500">Item</th>
          <th className="py-1 text-right text-[7px] uppercase text-gray-500">Qty</th>
          <th className="py-1 text-right text-[7px] uppercase text-gray-500">Price</th>
          {hasDiscount && <th className="py-1 text-right text-[7px] uppercase text-gray-500">Discount</th>}
          <th className="py-1 text-right text-[7px] uppercase text-gray-500">VAT</th>
          <th className="py-1 text-right text-[7px] uppercase text-gray-500">Total</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => (
          <tr key={line.id} className="border-b border-[#e8e5db]">
            <td className="py-1">{startIndex + i + 1}</td>
            <td className="py-1">{line.productName}</td>
            <td className="py-1 text-right">{line.quantity.toString()}</td>
            <td className="py-1 text-right">{money(line.unitPrice)}</td>
            {hasDiscount && <td className="py-1 text-right">{money(line.discount)}</td>}
            <td className="py-1 text-right">{money(line.lineVat)}</td>
            <td className="py-1 text-right">{money(line.lineTotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function A4Totals({ document }: { document: A4Document }) {
  return (
    <div className="absolute text-[8px]" style={{ bottom: "32mm", right: "20mm", width: "60mm" }}>
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{money(document.subtotal)} SAR</span>
      </div>
      <div className="flex justify-between">
        <span>Total VAT</span>
        <span>{money(document.vatTotal)} SAR</span>
      </div>
      <div className="mt-1 flex justify-between border-t border-black pt-1 text-[11px] font-bold">
        <span>Total Payable</span>
        <span>{money(document.grandTotal)} SAR</span>
      </div>
    </div>
  );
}

export function A4Note({ notes }: { notes: string }) {
  return (
    <div
      className="absolute rounded bg-[#eae7dd] p-2 text-[7.5px] leading-snug"
      style={{ bottom: "14mm", left: "20mm", right: "20mm" }}
    >
      Note: {truncateNote(notes)}
    </div>
  );
}

export function A4Footer() {
  return (
    <div className="absolute text-center text-[6.5px] text-gray-400" style={{ bottom: "8mm", left: 0, right: 0 }}>
      Powered By: FatooraSync
    </div>
  );
}
```

- [ ] **Step 11: Typecheck, lint, test**

Run: `npx tsc --noEmit`, `npm run lint`, `set -a && source .env && set +a && npx vitest run src/lib/print-format`
Expected: all clean, all `paginateA4Items`/`truncateNote` tests passing.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations package.json package-lock.json src/lib/print-format src/components/print-format
git commit -m "Add print-format schema fields and shared A4 infrastructure"
```

---

### Task 2: Settings API + Settings page UI

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/app/(app)/settings/page.tsx`
- Modify: `src/app/api/settings/route.test.ts`

**Interfaces:**
- Consumes: `PrintFormat`/`Tenant.phone` (Task 1).
- Produces: `GET /api/settings` response gains `phone` and `printFormat`; `PATCH /api/settings` accepts and validates both.

- [ ] **Step 1: Extend the settings route**

Replace the full contents of `src/app/api/settings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;

  const [settings, tenant] = await Promise.all([
    withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } })),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { phone: true } }),
  ]);

  return NextResponse.json({ ...settings, phone: tenant.phone });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const body = await request.json();

  const vatRate = Number(body.defaultVatRate);
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    return NextResponse.json(
      { error: "defaultVatRate must be a number between 0 and 100" },
      { status: 400 }
    );
  }

  if (body.language !== "ar" && body.language !== "en") {
    return NextResponse.json(
      { error: "language must be either \"ar\" or \"en\"" },
      { status: 400 }
    );
  }

  if (body.printFormat !== "THERMAL" && body.printFormat !== "A4") {
    return NextResponse.json(
      { error: "printFormat must be either \"THERMAL\" or \"A4\"" },
      { status: 400 }
    );
  }

  await withTenant(tenantId, (tx) =>
    tx.settings.update({
      where: { tenantId },
      data: { defaultVatRate: body.defaultVatRate, language: body.language, printFormat: body.printFormat },
    })
  );

  // Business phone lives on Tenant (alongside legalName/tradeName/vatNumber/crNumber/
  // address), not Settings -- it's a business-profile fact, not a preference. Tenant is
  // never accessed through withTenant() (same pattern as the print/PDF routes and the
  // receipt/quotation save routes' own `tenant.findUniqueOrThrow` calls); `where: { id:
  // tenantId }` is already exactly this tenant, taken from the session rather than from
  // request input, so there's no cross-tenant risk here.
  const trimmedPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  await prisma.tenant.update({ where: { id: tenantId }, data: { phone: trimmedPhone || null } });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Extend the Settings page**

Replace the full contents of `src/app/(app)/settings/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const [defaultVatRate, setDefaultVatRate] = useState("15");
  const [language, setLanguage] = useState("ar");
  const [printFormat, setPrintFormat] = useState("THERMAL");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDefaultVatRate(data.defaultVatRate);
        setLanguage(data.language);
        setPrintFormat(data.printFormat);
        setPhone(data.phone ?? "");
      });
  }, []);

  async function handleSave() {
    await fetch("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate, language, printFormat, phone }),
    });
  }

  return (
    <Card className="max-w-md border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="vat" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            Default VAT Rate (%)
          </Label>
          <Input id="vat" value={defaultVatRate} onChange={(e) => setDefaultVatRate(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="lang" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            Language
          </Label>
          <select
            id="lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="ar">Arabic</option>
            <option value="en">English</option>
          </select>
        </div>

        <div>
          <Label htmlFor="phone" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            Business Phone
          </Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966 5X XXX XXXX" />
        </div>

        <div>
          <Label
            htmlFor="printFormat"
            className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg"
          >
            Print Format
          </Label>
          <select
            id="printFormat"
            value={printFormat}
            onChange={(e) => setPrintFormat(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="THERMAL">Thermal (receipt roll)</option>
            <option value="A4">A4 (full page)</option>
          </select>
        </div>

        <Button onClick={handleSave} variant="primary">
          Save Changes
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Extend the tests**

In `src/app/api/settings/route.test.ts`, add these `it` blocks inside the existing `describe("/api/settings")`:

```ts
  it("GET returns the default printFormat and a null phone for a fresh tenant", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.printFormat).toBe("THERMAL");
    expect(body.phone).toBeNull();
  });

  it("PATCH updates printFormat and phone", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "15", language: "ar", printFormat: "A4", phone: "+966501234567" }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const afterSettings = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
    expect(afterSettings.printFormat).toBe("A4");
    const afterTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(afterTenant.phone).toBe("+966501234567");
  });

  it("PATCH clears the phone to null when an empty string is submitted", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "15", language: "ar", printFormat: "THERMAL", phone: "" }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const afterTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(afterTenant.phone).toBeNull();
  });

  it("PATCH returns 400 for an invalid printFormat", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "15", language: "ar", printFormat: "ROLL" }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(400);
  });
```

Also add `import { prisma } from "@/lib/db/client";` to the test file's imports if it isn't already there as a named import alongside `withTenant` (check the existing import block — it already imports `prisma` at the top, so this is likely already available; only add if missing).

- [ ] **Step 4: Run the tests**

Run: `set -a && source .env && set +a && npx vitest run src/app/api/settings/route.test.ts`
Expected: all pass, including the 4 new cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/route.ts "src/app/(app)/settings/page.tsx" src/app/api/settings/route.test.ts
git commit -m "Add Business Phone and Print Format to Settings"
```

---

### Task 3: Receipt A4 PDF template + route wiring

**Files:**
- Create: `src/lib/receipts/receipt-pdf-a4.tsx`
- Modify: `src/app/api/receipts/[id]/pdf/route.tsx`
- Modify: `src/app/api/receipts/[id]/pdf/route.test.ts`

**Interfaces:**
- Consumes: `paginateA4Items`, `truncateNote`, `a4PdfStyles`/`A4BusinessHeader`/`A4BilledTo`/`A4ItemsTable`/`A4Totals`/`A4Footer`/`A4Document` from Task 1's `src/lib/print-format/*`.
- Produces: `ReceiptPdfA4Document({ tenant, document, qrImageDataUrl })`, consumed by the modified PDF route.

- [ ] **Step 1: Write the A4 PDF template**

Create `src/lib/receipts/receipt-pdf-a4.tsx`:

```tsx
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import type { Tenant } from "@prisma/client";
import { paginateA4Items } from "@/lib/print-format/paginate-a4-items";
import { truncateNote } from "@/lib/print-format/truncate-note";
import {
  a4PdfStyles,
  A4BusinessHeader,
  A4BilledTo,
  A4ItemsTable,
  A4Totals,
  A4Footer,
  type A4Document,
} from "@/lib/print-format/a4-pdf-parts";

export interface ReceiptPdfA4Props {
  tenant: Tenant;
  document: A4Document;
  qrImageDataUrl: string | null;
}

export function ReceiptPdfA4Document({ tenant, document, qrImageDataUrl }: ReceiptPdfA4Props) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);
  const pageItemCounts = paginateA4Items(document.lines.length);

  let cursor = 0;
  return (
    <Document>
      {pageItemCounts.map((count, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pageItemCounts.length - 1;
        const pageLines = document.lines.slice(cursor, cursor + count);
        const startIndex = cursor;
        cursor += count;

        return (
          <Page key={pageIndex} size="A4" style={a4PdfStyles.page}>
            <A4BusinessHeader tenant={tenant} document={document} docTitle="INVOICE" docNumberLabel="Invoice" />
            <View style={a4PdfStyles.hr} />
            {isFirstPage && <A4BilledTo customer={document.customer} />}
            <A4ItemsTable lines={pageLines} startIndex={startIndex} hasDiscount={hasDiscount} />
            {isLastPage && (
              <>
                {qrImageDataUrl && (
                  // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image, not an HTML img element
                  <Image src={qrImageDataUrl} style={a4PdfStyles.qr} />
                )}
                <A4Totals document={document} />
                {document.notes && (
                  <View style={a4PdfStyles.note}>
                    <Text>Note: {truncateNote(document.notes)}</Text>
                  </View>
                )}
              </>
            )}
            <A4Footer />
          </Page>
        );
      })}
    </Document>
  );
}
```

- [ ] **Step 2: Wire the route**

Replace the full contents of `src/app/api/receipts/[id]/pdf/route.tsx`:

```tsx
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { ReceiptPdfDocument } from "@/lib/receipts/receipt-pdf";
import { ReceiptPdfA4Document } from "@/lib/receipts/receipt-pdf-a4";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const { id } = await params;

  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type: "SALES_RECEIPT" },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const qrImageDataUrl = document.qrCode ? await QRCode.toDataURL(document.qrCode) : null;

  const buffer = await renderToBuffer(
    settings.printFormat === "A4" ? (
      <ReceiptPdfA4Document tenant={tenant} document={document} qrImageDataUrl={qrImageDataUrl} />
    ) : (
      <ReceiptPdfDocument tenant={tenant} document={document} qrImageDataUrl={qrImageDataUrl} />
    )
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${document.number}.pdf"`,
    },
  });
}
```

- [ ] **Step 3: Add the A4 test case**

In `src/app/api/receipts/[id]/pdf/route.test.ts`, add this `it` block inside the existing `describe`:

```ts
  it("returns a non-empty A4 PDF when the tenant's printFormat is A4", { timeout: 30000 }, async () => {
    await prisma.settings.update({ where: { tenantId }, data: { printFormat: "A4" } });
    try {
      const response = await GET(pdfRequest(), { params: Promise.resolve({ id: receiptId }) });
      expect(response.status).toBe(200);
      const buffer = await response.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
      const magic = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 4));
      expect(magic).toBe("%PDF");
    } finally {
      await prisma.settings.update({ where: { tenantId }, data: { printFormat: "THERMAL" } });
    }
  });

  it("still returns the thermal PDF when printFormat is THERMAL (regression guard)", { timeout: 30000 }, async () => {
    const response = await GET(pdfRequest(), { params: Promise.resolve({ id: receiptId }) });
    expect(response.status).toBe(200);
    const buffer = await response.arrayBuffer();
    const magic = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 4));
    expect(magic).toBe("%PDF");
  });
```

- [ ] **Step 4: Manual A4 rendering check**

The pagination constants in Task 1 are a first estimate, not a certainty — verify them here, on the first real A4 PDF template. Write a small throwaway script (deleted before committing) that calls `renderToBuffer(<ReceiptPdfA4Document ... />)` twice: once with exactly `SINGLE_PAGE_MAX_ITEMS` (14) fake line items and a `notes` value near the ~220-character truncation limit, once with `SINGLE_PAGE_MAX_ITEMS + 1` (15) to confirm it correctly produces a second page. Write each buffer to a `.pdf` file and use the Read tool to visually inspect: no text/QR/totals overlap, the note box doesn't collide with the totals, the `#` column numbers correctly, and page 2 in the 15-item case shows no items but does show totals/QR/note/footer. If anything overflows, adjust the constants in `paginate-a4-items.ts` (Task 1) or the spacing in `a4-pdf-parts.tsx` — whichever is actually wrong — and re-check.

- [ ] **Step 5: Run the tests**

Run: `set -a && source .env && set +a && npx vitest run src/app/api/receipts/[id]/pdf/route.test.ts`
Expected: all pass, including the two new cases.

- [ ] **Step 6: Commit**

```bash
git add src/lib/receipts/receipt-pdf-a4.tsx src/app/api/receipts/[id]/pdf/route.tsx src/app/api/receipts/[id]/pdf/route.test.ts
git commit -m "Add A4 PDF template for Sales Receipt"
```

---

### Task 4: Receipt A4 print page + route wiring

**Files:**
- Create: `src/components/receipts/receipt-print-thermal.tsx`
- Create: `src/components/receipts/receipt-print-a4.tsx`
- Modify: `src/app/(app)/receipts/[id]/print/page.tsx`

**Interfaces:**
- Consumes: Task 1's shared A4 print components; `ReceiptPdfA4Document`'s sibling data shape (`A4Document` from `@/lib/print-format/a4-pdf-parts`, reused here too since it's the same `Tenant`/`Document`/`Customer`/`DocumentLine` shape).
- Produces: page at `/receipts/[id]/print`, unchanged URL, now branching on `printFormat`.

- [ ] **Step 1: Extract the existing thermal design, unchanged**

Create `src/components/receipts/receipt-print-thermal.tsx` — this is the *exact* JSX body currently inline in `src/app/(app)/receipts/[id]/print/page.tsx`, moved verbatim into its own component (byte-identical output, zero behavior change):

```tsx
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { PrintButton } from "./print-button";

function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

type ReceiptDocument = PrismaDocument & { customer: Customer; lines: DocumentLine[] };

export function ReceiptPrintThermal({
  tenant,
  document,
  qrImageDataUrl,
}: {
  tenant: Tenant;
  document: ReceiptDocument;
  qrImageDataUrl: string | null;
}) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);

  return (
    <div className="mx-auto max-w-[420px] bg-white p-6 text-sm text-black print:p-0" dir="ltr">
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
            {hasDiscount && <th className="py-1 text-right">Discount</th>}
            <th className="py-1 text-right">VAT</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {document.lines.map((line) => (
            <tr key={line.id} className="border-b border-gray-300">
              <td className="py-1">{line.productName}</td>
              <td className="py-1 text-right">{line.quantity.toString()}</td>
              <td className="py-1 text-right">{money(line.unitPrice)}</td>
              {hasDiscount && <td className="py-1 text-right">{money(line.discount)}</td>}
              <td className="py-1 text-right">{money(line.lineVat)}</td>
              <td className="py-1 text-right">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span>الإجمالي الفرعي / Subtotal</span>
          <span>{money(document.subtotal)} SAR</span>
        </div>
        <div className="flex justify-between">
          <span>ضريبة القيمة المضافة / VAT Total</span>
          <span>{money(document.vatTotal)} SAR</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>الإجمالي / Grand Total</span>
          <span>{money(document.grandTotal)} SAR</span>
        </div>
      </div>

      {document.notes && <div className="mt-3 text-xs">Notes: {document.notes}</div>}

      {qrImageDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrImageDataUrl} alt="ZATCA QR code" className="mx-auto mt-4 h-32 w-32" />
      )}

      <PrintButton />

      <style>{`
        @media print {
          aside,
          [aria-hidden] { display: none !important; }
          div.border-b.border-border-subtle.backdrop-blur-sm { display: none !important; }
          .flex.h-screen { display: block !important; height: auto !important; }
          .overflow-hidden.bg-bg-app { overflow: visible !important; }
          main { padding: 0 !important; overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Write the A4 print component**

Create `src/components/receipts/receipt-print-a4.tsx`:

```tsx
import { Prata, Inter } from "next/font/google";
import type { Tenant } from "@prisma/client";
import { paginateA4Items } from "@/lib/print-format/paginate-a4-items";
import {
  A4BusinessHeader,
  A4BilledTo,
  A4ItemsTable,
  A4Totals,
  A4Note,
  A4Footer,
  type A4Document,
} from "@/components/print-format/a4-print-parts";
import { PrintButton } from "./print-button";

const prata = Prata({ subsets: ["latin"], weight: "400" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "600"] });

export function ReceiptPrintA4({
  tenant,
  document,
  qrImageDataUrl,
}: {
  tenant: Tenant;
  document: A4Document;
  qrImageDataUrl: string | null;
}) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);
  const pageItemCounts = paginateA4Items(document.lines.length);

  let cursor = 0;

  return (
    <div className={inter.className}>
      {pageItemCounts.map((count, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pageItemCounts.length - 1;
        const pageLines = document.lines.slice(cursor, cursor + count);
        const startIndex = cursor;
        cursor += count;

        return (
          <div
            key={pageIndex}
            className="a4-page mx-auto bg-white text-[9px] text-black"
            style={{ width: "210mm", minHeight: "297mm", padding: "20mm", boxSizing: "border-box", position: "relative" }}
          >
            <A4BusinessHeader
              tenant={tenant}
              document={document}
              docTitle="INVOICE"
              docNumberLabel="Invoice"
              prataClassName={prata.className}
            />
            <hr className="my-3 border-[#d8d4c8]" />
            {isFirstPage && <A4BilledTo customer={document.customer} />}
            <A4ItemsTable lines={pageLines} startIndex={startIndex} hasDiscount={hasDiscount} />
            {isLastPage && (
              <>
                {qrImageDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrImageDataUrl}
                    alt="ZATCA QR code"
                    className="absolute h-16 w-16"
                    style={{ bottom: "32mm", left: "20mm" }}
                  />
                )}
                <A4Totals document={document} />
                {document.notes && <A4Note notes={document.notes} />}
              </>
            )}
            <A4Footer />
          </div>
        );
      })}

      <PrintButton />

      <style>{`
        @media screen {
          .a4-page { margin-bottom: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
        }
        @media print {
          aside,
          [aria-hidden] { display: none !important; }
          div.border-b.border-border-subtle.backdrop-blur-sm { display: none !important; }
          .flex.h-screen { display: block !important; height: auto !important; }
          .overflow-hidden.bg-bg-app { overflow: visible !important; }
          main { padding: 0 !important; overflow: visible !important; }
          .a4-page { break-after: page; box-shadow: none !important; margin-bottom: 0 !important; }
          .a4-page:last-child { break-after: auto; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Wire the page**

Replace the full contents of `src/app/(app)/receipts/[id]/print/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { ReceiptPrintThermal } from "@/components/receipts/receipt-print-thermal";
import { ReceiptPrintA4 } from "@/components/receipts/receipt-print-a4";

export default async function ReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type: "SALES_RECEIPT" },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) {
    notFound();
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const qrImageDataUrl = document.qrCode ? await QRCode.toDataURL(document.qrCode) : null;

  if (settings.printFormat === "A4") {
    return <ReceiptPrintA4 tenant={tenant} document={document} qrImageDataUrl={qrImageDataUrl} />;
  }
  return <ReceiptPrintThermal tenant={tenant} document={document} qrImageDataUrl={qrImageDataUrl} />;
}
```

- [ ] **Step 4: Manual browser verification**

Do **not** use the shared `fatoorasync-dev` preview config — it resolves to whichever worktree it was last pointed at and has caused false 404s in prior tasks on this project. Instead, run `set -a && source .env && set +a && npm run dev -- -p <a free port>` directly in this worktree as a background command, then `mcp__Claude_Browser__preview_start` with `{url: "http://localhost:<port>"}`. Log in as the seeded demo tenant (`owner@demo.local` / `changeme123` from `prisma/seed.ts`). Set the tenant's Print Format to A4 via `/settings`, fill in a Business Phone, then:
1. Open an existing receipt's `/receipts/{id}/print` (or create a new one first) with fewer than 14 lines — confirm it's a single A4 page with Prata "INVOICE" heading, the business header (including phone), Billed To grid, numbered items, QR code, totals, note, and the "Powered By: FatooraSync" footer.
2. Confirm the thermal design still renders correctly when Print Format is set back to Thermal (regression check — should look identical to before this task).
3. If you can create a receipt with 15+ line items easily, confirm it spans two pages correctly (no Billed To repeat, no QR/totals/note on page 1, page 2 has them). If not practical to test live, this was already verified via the PDF template's rendered check in Task 3 using the same shared `paginateA4Items`/`a4-pdf-parts` styling proportions — note in your report which path you used.
Stop the dev server process when done so it doesn't linger.

- [ ] **Step 5: Typecheck, lint, test, build**

Run: `npx tsc --noEmit`, `npm run lint`, `set -a && source .env && set +a && npm test`, `npm run build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/receipts/receipt-print-thermal.tsx src/components/receipts/receipt-print-a4.tsx "src/app/(app)/receipts/[id]/print/page.tsx"
git commit -m "Add A4 print page for Sales Receipt"
```

---

### Task 5: Quotation A4 PDF template + route wiring

**Files:**
- Create: `src/lib/quotations/quotation-pdf-a4.tsx`
- Modify: `src/app/api/quotations/[id]/pdf/route.tsx`
- Modify: `src/app/api/quotations/[id]/pdf/route.test.ts`

**Interfaces:**
- Consumes: same Task 1 shared modules as Task 3.
- Produces: `QuotationPdfA4Document({ tenant, document })` — no `qrImageDataUrl` prop; Quotation never has QR data.

- [ ] **Step 1: Write the A4 PDF template**

Create `src/lib/quotations/quotation-pdf-a4.tsx`:

```tsx
import { Document, Page, View, Text } from "@react-pdf/renderer";
import type { Tenant } from "@prisma/client";
import { paginateA4Items } from "@/lib/print-format/paginate-a4-items";
import { truncateNote } from "@/lib/print-format/truncate-note";
import {
  a4PdfStyles,
  A4BusinessHeader,
  A4BilledTo,
  A4ItemsTable,
  A4Totals,
  A4Footer,
  type A4Document,
} from "@/lib/print-format/a4-pdf-parts";

export interface QuotationPdfA4Props {
  tenant: Tenant;
  document: A4Document;
}

export function QuotationPdfA4Document({ tenant, document }: QuotationPdfA4Props) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);
  const pageItemCounts = paginateA4Items(document.lines.length);

  let cursor = 0;
  return (
    <Document>
      {pageItemCounts.map((count, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pageItemCounts.length - 1;
        const pageLines = document.lines.slice(cursor, cursor + count);
        const startIndex = cursor;
        cursor += count;

        return (
          <Page key={pageIndex} size="A4" style={a4PdfStyles.page}>
            <A4BusinessHeader tenant={tenant} document={document} docTitle="QUOTATION" docNumberLabel="Quotation" />
            <View style={a4PdfStyles.hr} />
            {isFirstPage && <A4BilledTo customer={document.customer} />}
            <A4ItemsTable lines={pageLines} startIndex={startIndex} hasDiscount={hasDiscount} />
            {isLastPage && (
              <>
                <A4Totals document={document} />
                {document.notes && (
                  <View style={a4PdfStyles.note}>
                    <Text>Note: {truncateNote(document.notes)}</Text>
                  </View>
                )}
              </>
            )}
            <A4Footer />
          </Page>
        );
      })}
    </Document>
  );
}
```

- [ ] **Step 2: Wire the route**

Replace the full contents of `src/app/api/quotations/[id]/pdf/route.tsx`:

```tsx
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { QuotationPdfDocument } from "@/lib/quotations/quotation-pdf";
import { QuotationPdfA4Document } from "@/lib/quotations/quotation-pdf-a4";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const { id } = await params;

  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type: "QUOTATION" },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const buffer = await renderToBuffer(
    settings.printFormat === "A4" ? (
      <QuotationPdfA4Document tenant={tenant} document={document} />
    ) : (
      <QuotationPdfDocument tenant={tenant} document={document} />
    )
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="quotation-${document.number}.pdf"`,
    },
  });
}
```

- [ ] **Step 3: Add the A4 test case**

In `src/app/api/quotations/[id]/pdf/route.test.ts`, add inside the existing `describe`:

```ts
  it("returns a non-empty A4 PDF when the tenant's printFormat is A4", { timeout: 30000 }, async () => {
    await prisma.settings.update({ where: { tenantId }, data: { printFormat: "A4" } });
    try {
      const response = await GET(pdfRequest(), { params: Promise.resolve({ id: quotationId }) });
      expect(response.status).toBe(200);
      const buffer = await response.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
      const magic = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 4));
      expect(magic).toBe("%PDF");
    } finally {
      await prisma.settings.update({ where: { tenantId }, data: { printFormat: "THERMAL" } });
    }
  });

  it("still returns the thermal PDF when printFormat is THERMAL (regression guard)", { timeout: 30000 }, async () => {
    const response = await GET(pdfRequest(), { params: Promise.resolve({ id: quotationId }) });
    expect(response.status).toBe(200);
    const buffer = await response.arrayBuffer();
    const magic = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 4));
    expect(magic).toBe("%PDF");
  });
```

- [ ] **Step 4: Manual A4 rendering check**

Same discipline as Task 3 Step 4: render `QuotationPdfA4Document` via a throwaway script with exactly 14 and 15 fake line items, inspect the generated PDFs with the Read tool, confirm no overlap and correct pagination, adjust constants/spacing if needed, delete the script before committing.

- [ ] **Step 5: Run the tests**

Run: `set -a && source .env && set +a && npx vitest run src/app/api/quotations/[id]/pdf/route.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/quotations/quotation-pdf-a4.tsx src/app/api/quotations/[id]/pdf/route.tsx src/app/api/quotations/[id]/pdf/route.test.ts
git commit -m "Add A4 PDF template for Quotation"
```

---

### Task 6: Quotation A4 print page + route wiring

**Files:**
- Create: `src/components/quotations/quotation-print-thermal.tsx`
- Create: `src/components/quotations/quotation-print-a4.tsx`
- Modify: `src/app/(app)/quotations/[id]/print/page.tsx`

**Interfaces:**
- Consumes: same Task 1 shared browser components as Task 4.
- Produces: page at `/quotations/[id]/print`, unchanged URL, now branching on `printFormat`.

- [ ] **Step 1: Extract the existing thermal design, unchanged**

Create `src/components/quotations/quotation-print-thermal.tsx` — the exact JSX body currently inline in `src/app/(app)/quotations/[id]/print/page.tsx`, moved verbatim:

```tsx
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { PrintButton } from "@/components/receipts/print-button";

function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

type QuotationDocument = PrismaDocument & { customer: Customer; lines: DocumentLine[] };

export function QuotationPrintThermal({
  tenant,
  document,
}: {
  tenant: Tenant;
  document: QuotationDocument;
}) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);

  return (
    <div className="mx-auto max-w-[420px] bg-white p-6 text-sm text-black print:p-0" dir="ltr">
      <div className="mb-4 text-center">
        <div className="text-lg font-bold">{tenant.tradeNameAr ?? tenant.tradeNameEn}</div>
        <div className="text-base">{tenant.tradeNameEn}</div>
        <div className="mt-1 text-xs">
          {tenant.legalName} — VAT {tenant.vatNumber}
        </div>
        {tenant.address && <div className="text-xs">{tenant.address}</div>}
      </div>

      <div className="mb-3 flex justify-between text-xs">
        <span>QUOTATION (عرض سعر) #{document.number}</span>
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
            {hasDiscount && <th className="py-1 text-right">Discount</th>}
            <th className="py-1 text-right">VAT</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {document.lines.map((line) => (
            <tr key={line.id} className="border-b border-gray-300">
              <td className="py-1">{line.productName}</td>
              <td className="py-1 text-right">{line.quantity.toString()}</td>
              <td className="py-1 text-right">{money(line.unitPrice)}</td>
              {hasDiscount && <td className="py-1 text-right">{money(line.discount)}</td>}
              <td className="py-1 text-right">{money(line.lineVat)}</td>
              <td className="py-1 text-right">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span>الإجمالي الفرعي / Subtotal</span>
          <span>{money(document.subtotal)} SAR</span>
        </div>
        <div className="flex justify-between">
          <span>ضريبة القيمة المضافة / VAT Total</span>
          <span>{money(document.vatTotal)} SAR</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>الإجمالي / Grand Total</span>
          <span>{money(document.grandTotal)} SAR</span>
        </div>
      </div>

      {document.notes && <div className="mt-3 text-xs">Notes: {document.notes}</div>}

      <PrintButton />

      <style>{`
        @media print {
          aside,
          [aria-hidden] { display: none !important; }
          div.border-b.border-border-subtle.backdrop-blur-sm { display: none !important; }
          .flex.h-screen { display: block !important; height: auto !important; }
          .overflow-hidden.bg-bg-app { overflow: visible !important; }
          main { padding: 0 !important; overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Write the A4 print component**

Create `src/components/quotations/quotation-print-a4.tsx`:

```tsx
import { Prata, Inter } from "next/font/google";
import type { Tenant } from "@prisma/client";
import { paginateA4Items } from "@/lib/print-format/paginate-a4-items";
import {
  A4BusinessHeader,
  A4BilledTo,
  A4ItemsTable,
  A4Totals,
  A4Note,
  A4Footer,
  type A4Document,
} from "@/components/print-format/a4-print-parts";
import { PrintButton } from "@/components/receipts/print-button";

const prata = Prata({ subsets: ["latin"], weight: "400" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "600"] });

export function QuotationPrintA4({ tenant, document }: { tenant: Tenant; document: A4Document }) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);
  const pageItemCounts = paginateA4Items(document.lines.length);

  let cursor = 0;

  return (
    <div className={inter.className}>
      {pageItemCounts.map((count, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pageItemCounts.length - 1;
        const pageLines = document.lines.slice(cursor, cursor + count);
        const startIndex = cursor;
        cursor += count;

        return (
          <div
            key={pageIndex}
            className="a4-page mx-auto bg-white text-[9px] text-black"
            style={{ width: "210mm", minHeight: "297mm", padding: "20mm", boxSizing: "border-box", position: "relative" }}
          >
            <A4BusinessHeader
              tenant={tenant}
              document={document}
              docTitle="QUOTATION"
              docNumberLabel="Quotation"
              prataClassName={prata.className}
            />
            <hr className="my-3 border-[#d8d4c8]" />
            {isFirstPage && <A4BilledTo customer={document.customer} />}
            <A4ItemsTable lines={pageLines} startIndex={startIndex} hasDiscount={hasDiscount} />
            {isLastPage && (
              <>
                <A4Totals document={document} />
                {document.notes && <A4Note notes={document.notes} />}
              </>
            )}
            <A4Footer />
          </div>
        );
      })}

      <PrintButton />

      <style>{`
        @media screen {
          .a4-page { margin-bottom: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
        }
        @media print {
          aside,
          [aria-hidden] { display: none !important; }
          div.border-b.border-border-subtle.backdrop-blur-sm { display: none !important; }
          .flex.h-screen { display: block !important; height: auto !important; }
          .overflow-hidden.bg-bg-app { overflow: visible !important; }
          main { padding: 0 !important; overflow: visible !important; }
          .a4-page { break-after: page; box-shadow: none !important; margin-bottom: 0 !important; }
          .a4-page:last-child { break-after: auto; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Wire the page**

Replace the full contents of `src/app/(app)/quotations/[id]/print/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { QuotationPrintThermal } from "@/components/quotations/quotation-print-thermal";
import { QuotationPrintA4 } from "@/components/quotations/quotation-print-a4";

export default async function QuotationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type: "QUOTATION" },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) {
    notFound();
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  if (settings.printFormat === "A4") {
    return <QuotationPrintA4 tenant={tenant} document={document} />;
  }
  return <QuotationPrintThermal tenant={tenant} document={document} />;
}
```

- [ ] **Step 4: Manual browser verification**

Same approach as Task 4 Step 4 (own scoped dev server on a free port, not the shared `fatoorasync-dev` config). With Print Format set to A4:
1. Create/open a quotation with fewer than 14 lines, confirm the single-page A4 layout — business header (with phone), Billed To grid, numbered items, totals, note, footer, and **no QR block anywhere on the page**.
2. Confirm the thermal quotation design still renders correctly when Print Format is set back to Thermal.
3. Confirm `/receipts` and `/receipts/new` and the Receipt A4/thermal print pages from Task 4 are unaffected by this task's changes.
Stop the dev server when done.

- [ ] **Step 5: Typecheck, lint, full test suite, build**

Run: `npx tsc --noEmit`, `npm run lint`, `set -a && source .env && set +a && npm test`, `npm run build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/quotations/quotation-print-thermal.tsx src/components/quotations/quotation-print-a4.tsx "src/app/(app)/quotations/[id]/print/page.tsx"
git commit -m "Add A4 print page for Quotation"
```

---

## Final whole-branch review

After all six tasks are complete and committed, dispatch a broad review of the entire branch diff before finishing the branch — same rigor as every prior cycle in this project, with particular attention to: **the thermal design is genuinely byte-identical to before this branch** (diff the extracted `*-print-thermal.tsx` components against the pre-branch inline JSX to confirm the refactor introduced zero visual changes); tenant isolation on the two modified PDF/print routes; the `#` serial numbering stays correct and continuous across a page break; Quotation's A4 output never renders a QR block under any circumstance; and the pagination constants were actually rendered-and-inspected (Task 3/5 Step 4) rather than only unit-tested.
