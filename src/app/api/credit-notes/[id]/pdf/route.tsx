import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/lib/auth/config";
import { getDocumentPrintData } from "@/lib/receipts/get-print-data";
import { ReceiptPdfDocument } from "@/lib/receipts/receipt-pdf";
import { ReceiptPdfA4Document } from "@/lib/receipts/receipt-pdf-a4";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const data = await getDocumentPrintData(tenantId, id, "CREDIT_NOTE");
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await renderToBuffer(
    data.printFormat === "A4" ? (
      <ReceiptPdfA4Document tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />
    ) : (
      <ReceiptPdfDocument tenant={data.tenant} document={data.document} qrImageDataUrl={data.qrImageDataUrl} />
    )
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="credit-note-${data.document.number}.pdf"`,
    },
  });
}
