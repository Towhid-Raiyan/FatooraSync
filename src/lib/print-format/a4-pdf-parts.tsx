import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { formatRiyadhDateTime, formatHijriDate } from "@/lib/format-datetime";
import "./a4-fonts";

// Layout note: totals/QR/note/footer used to be `position: absolute` anchored to
// the bottom of the page. That caused two real problems -- a short document (2-3
// items) left a huge visual gap between the item table and the totals block "way
// below" it, and because the page container's real height could exceed its
// nominal A4 size, the bottom-anchored blocks sometimes landed past the true
// printable area and spilled onto a second physical page. Everything below the
// item table is normal document flow now: it renders immediately after the last
// item row, wherever that is, so a short document reads compactly and nothing
// can silently overflow onto a page it doesn't belong on.
export const a4PdfStyles = StyleSheet.create({
  page: { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, color: "#1a1a1a", padding: 32, backgroundColor: "#f7f5f0" },
  headerRow: { flexDirection: "row", justifyContent: "space-between" },
  bizNameAr: { fontSize: 15, fontWeight: "bold" },
  bizNameEn: { fontSize: 13, fontWeight: "bold" },
  bizLine: { fontSize: 10, color: "#555555", marginTop: 2 },
  docTitle: { fontFamily: "Prata", fontSize: 22, textAlign: "right" },
  docTitleAr: { fontSize: 11, color: "#555555", textAlign: "right", marginTop: 2 },
  meta: { fontSize: 10, color: "#555555", textAlign: "right", marginTop: 4 },
  hr: { borderBottomWidth: 1, borderColor: "#d8d4c8", marginVertical: 12 },
  billedLabel: { fontSize: 11, fontWeight: "bold", marginBottom: 6 },
  billedGrid: { flexDirection: "row", flexWrap: "wrap" },
  billedCell: { width: "50%", fontSize: 10, marginBottom: 5 },
  billedCellFull: { width: "100%", fontSize: 10, marginBottom: 5 },
  billedLbl: { fontSize: 9, color: "#888888" },
  table: { marginTop: 10 },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#1a1a1a",
    paddingBottom: 5,
    marginBottom: 5,
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e8e5db", paddingVertical: 5 },
  colNum: { width: "6%", fontSize: 10 },
  colItem: { width: "34%", fontSize: 10 },
  colQty: { width: "12%", fontSize: 10, textAlign: "right" },
  colPrice: { width: "14%", fontSize: 10, textAlign: "right" },
  colVat: { width: "12%", fontSize: 10, textAlign: "right" },
  colTotal: { width: "16%", fontSize: 10, textAlign: "right" },
  colDiscount: { width: "12%", fontSize: 10, textAlign: "right" },
  headerCell: { fontSize: 8.5, fontWeight: "bold", textTransform: "uppercase", color: "#777777" },
  bottomSection: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 18 },
  qr: { width: 64, height: 64 },
  totalsBlock: { width: 190 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4, fontSize: 10 },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
    paddingTop: 5,
    borderTopWidth: 1,
    borderColor: "#1a1a1a",
    fontSize: 13,
    fontWeight: "bold",
  },
  note: {
    marginTop: 14,
    backgroundColor: "#eae7dd",
    padding: 8,
    borderRadius: 3,
    fontSize: 10,
    lineHeight: 1.4,
  },
  // Absolutely positioned against the Page (react-pdf's standard footer
  // pattern), anchored a few points above the physical page edge -- see the
  // matching HTML A4Footer's comment for why this specific element is safe to
  // bottom-anchor even though the taller totals/QR/note block above it isn't.
  footer: { position: "absolute", bottom: 6, left: 0, right: 0, textAlign: "center", fontSize: 8.5, color: "#aaaaaa" },
});

export function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

export type A4Document = PrismaDocument & { customer: Customer; lines: DocumentLine[] };

export function A4BusinessHeader({
  tenant,
  document,
  docTitleEn,
  docTitleAr,
  docNumberLabel,
  formatNumber = String,
}: {
  tenant: Tenant;
  document: A4Document;
  docTitleEn: string;
  docTitleAr?: string;
  docNumberLabel: string;
  formatNumber?: (number: number) => string;
}) {
  return (
    <View style={a4PdfStyles.headerRow}>
      <View>
        {tenant.tradeNameAr && <Text style={a4PdfStyles.bizNameAr}>{tenant.tradeNameAr}</Text>}
        <Text style={a4PdfStyles.bizNameEn}>{tenant.legalName}</Text>
        <Text style={a4PdfStyles.bizLine}>VAT ID: {tenant.vatNumber}</Text>
        {tenant.crNumber && <Text style={a4PdfStyles.bizLine}>CR No: {tenant.crNumber}</Text>}
        {tenant.phone && <Text style={a4PdfStyles.bizLine}>Phone: {tenant.phone}</Text>}
        {tenant.address && <Text style={a4PdfStyles.bizLine}>{tenant.address}</Text>}
      </View>
      <View>
        <Text style={a4PdfStyles.docTitle}>{docTitleEn}</Text>
        {docTitleAr && <Text style={a4PdfStyles.docTitleAr}>{docTitleAr}</Text>}
        <Text style={a4PdfStyles.meta}>
          {docNumberLabel} No. {formatNumber(document.number)}
        </Text>
        <Text style={a4PdfStyles.meta}>{formatRiyadhDateTime(document.createdAt)}</Text>
        <Text style={a4PdfStyles.meta}>{formatHijriDate(document.createdAt)}</Text>
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

// Combines the QR code (receipt only -- `qrImageDataUrl` is omitted entirely for
// quotations, which never have one) and the totals block into one row, right
// after the item table in normal flow. `justify-content: space-between` still
// pushes totals to the right even when there's no QR to anchor the left side.
export function A4TotalsRow({
  document,
  qrImageDataUrl,
}: {
  document: A4Document;
  qrImageDataUrl?: string | null;
}) {
  return (
    <View style={a4PdfStyles.bottomSection}>
      {qrImageDataUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image, not an HTML img element
        <Image src={qrImageDataUrl} style={a4PdfStyles.qr} />
      ) : (
        <View />
      )}
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
    </View>
  );
}

export function A4Footer() {
  return <Text style={a4PdfStyles.footer}>Powered By: FatooraSync</Text>;
}
