import path from "path";
import { Document, Page, View, Text, Image, Font, StyleSheet } from "@react-pdf/renderer";
import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { formatRiyadhDateTime, formatHijriDate } from "@/lib/format-datetime";

// 80mm is the standard thermal receipt-roll width (58mm is the other common
// size, but too narrow for this 5-6 column item table); 1mm = 2.83465pt.
// @react-pdf/renderer has no "auto height" page mode -- a thermal roll is
// continuous paper, not a fixed-length sheet, so the height is estimated from
// the actual content instead of a fixed constant, to avoid clipping longer
// receipts or leaving excess blank paper on short ones.
const THERMAL_WIDTH_PT = 80 * 2.83465;
const THERMAL_BASE_HEIGHT_PT = 180; // header + meta (label may wrap) + hijri line + customer block + table header + totals + page padding
const THERMAL_ROW_HEIGHT_PT = 13;
const THERMAL_NOTES_HEIGHT_PT = 16;
const THERMAL_QR_HEIGHT_PT = 130;

function estimateThermalPageHeight(lineCount: number, hasNotes: boolean, hasQr: boolean): number {
  return (
    THERMAL_BASE_HEIGHT_PT +
    lineCount * THERMAL_ROW_HEIGHT_PT +
    (hasNotes ? THERMAL_NOTES_HEIGHT_PT : 0) +
    (hasQr ? THERMAL_QR_HEIGHT_PT : 0)
  );
}

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
    padding: 10,
  },
  center: { textAlign: "center", marginBottom: 12 },
  tradeNameAr: { fontSize: 13, fontWeight: "bold" },
  legalLine: { fontSize: 8, marginTop: 2 },
  meta: { fontSize: 8, marginBottom: 8 },
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
  const pageHeight = estimateThermalPageHeight(document.lines.length, Boolean(document.notes), Boolean(qrImageDataUrl));

  return (
    <Document>
      <Page size={[THERMAL_WIDTH_PT, pageHeight]} style={styles.page}>
        <View style={styles.center}>
          <Text style={styles.tradeNameAr}>{tenant.tradeNameAr ?? tenant.tradeNameEn}</Text>
          <Text style={styles.legalLine}>
            {tenant.legalName} — VAT {tenant.vatNumber}
          </Text>
          {(tenant.crNumber || tenant.phone) && (
            <Text style={styles.legalLine}>
              {tenant.crNumber ? `CR: ${tenant.crNumber}` : ""}
              {tenant.crNumber && tenant.phone ? " | " : ""}
              {tenant.phone ? `Phone: ${tenant.phone}` : ""}
            </Text>
          )}
          {tenant.address && <Text style={styles.legalLine}>{tenant.address}</Text>}
        </View>

        <View style={styles.meta}>
          <Text>فاتورة ضريبية مبسطة / Simplified Tax Invoice #{document.number}</Text>
          <Text>{formatRiyadhDateTime(document.createdAt)}</Text>
          <Text>{formatHijriDate(document.createdAt)}</Text>
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

        {/* eslint-disable-next-line jsx-a11y/alt-text -- this is @react-pdf/renderer's Image (a PDF drawing primitive), not an HTML img element; it has no alt prop */}
        {qrImageDataUrl && <Image src={qrImageDataUrl} style={styles.qr} />}
      </Page>
    </Document>
  );
}
