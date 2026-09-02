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
