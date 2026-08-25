import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/lib/auth/config";
import { getQuotationPrintData } from "@/lib/quotations/get-print-data";
import { QuotationPdfDocument } from "@/lib/quotations/quotation-pdf";
import { QuotationPdfA4Document } from "@/lib/quotations/quotation-pdf-a4";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { formatQuotationNumber } from "@/lib/quotations/quotation-number";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const data = await getQuotationPrintData(tenantId, id);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await renderToBuffer(
    data.printFormat === "A4" ? (
      <QuotationPdfA4Document tenant={data.tenant} document={data.document} />
    ) : (
      <QuotationPdfDocument tenant={data.tenant} document={data.document} />
    )
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="quotation-${formatQuotationNumber(data.document.number)}.pdf"`,
    },
  });
}
