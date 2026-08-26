import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { LabelItem } from "./build-label-items";

const MM_TO_PT = 2.83465;

export interface LabelPdfProps {
  tenantTradeName: string;
  items: LabelItem[];
  labelWidthMm: number;
  labelHeightMm: number;
}

// Labels print off a continuous roll, not a fixed-length sheet -- same reason
// the thermal receipt PDFs (receipt-pdf.tsx) use a dynamically computed page
// height instead of a fixed size. One page, one label per `copies` count,
// stacked vertically at the tenant's configured label size (Settings.labelWidthMm/
// labelHeightMm).
export function LabelPdfDocument({ tenantTradeName, items, labelWidthMm, labelHeightMm }: LabelPdfProps) {
  const widthPt = labelWidthMm * MM_TO_PT;
  const labelHeightPt = labelHeightMm * MM_TO_PT;
  const totalCopies = items.reduce((sum, item) => sum + item.copies, 0);
  const heightPt = Math.max(labelHeightPt, totalCopies * labelHeightPt);

  const styles = StyleSheet.create({
    page: { fontFamily: "Helvetica" },
    label: {
      width: widthPt,
      height: labelHeightPt,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 4,
      borderBottomWidth: 0.5,
      borderColor: "#CCCCCC",
    },
    tradeName: { fontSize: 8, fontWeight: "bold", textAlign: "center" },
    barcode: { width: widthPt * 0.8, height: Math.max(labelHeightPt * 0.32, 18), marginTop: 2 },
    barcodeText: { fontSize: 6, color: "#444444", marginTop: 1 },
    productName: { fontSize: 7, fontWeight: "bold", textAlign: "center", marginTop: 2, paddingHorizontal: 4 },
    price: { fontSize: 9, fontWeight: "bold", marginTop: 1 },
    caption: { fontSize: 5.5, color: "#777777" },
  });

  const labels: LabelItem[] = [];
  for (const item of items) {
    for (let i = 0; i < item.copies; i++) labels.push(item);
  }

  return (
    <Document>
      <Page size={[widthPt, heightPt]} style={styles.page}>
        {labels.map((item, index) => (
          <View key={`${item.productId}-${index}`} style={styles.label}>
            <Text style={styles.tradeName}>{tenantTradeName}</Text>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image (a PDF drawing primitive), not an HTML img element */}
            <Image src={item.barcodeDataUrl} style={styles.barcode} />
            <Text style={styles.barcodeText}>{item.barcodeText}</Text>
            <Text style={styles.productName}>{item.productName}</Text>
            <Text style={styles.price}>SAR {item.price}</Text>
            <Text style={styles.caption}>(Incl. of all taxes)</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}
