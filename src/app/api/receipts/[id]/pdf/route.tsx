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

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${document.number}.pdf"`,
    },
  });
}
