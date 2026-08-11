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
