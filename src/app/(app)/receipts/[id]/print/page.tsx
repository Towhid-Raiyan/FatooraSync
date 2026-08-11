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
