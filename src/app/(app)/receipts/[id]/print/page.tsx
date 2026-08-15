import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getReceiptPrintData } from "@/lib/receipts/get-print-data";
import { ReceiptPrintThermal } from "@/components/receipts/receipt-print-thermal";
import { ReceiptPrintA4 } from "@/components/receipts/receipt-print-a4";

export default async function ReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const data = await getReceiptPrintData(tenantId, id);
  if (!data) {
    notFound();
  }

  if (data.printFormat === "A4") {
    return <ReceiptPrintA4 tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />;
  }
  return <ReceiptPrintThermal tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />;
}
