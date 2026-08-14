import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { QuotationPdfDocument } from "@/lib/quotations/quotation-pdf";
import { QuotationPdfA4Document } from "@/lib/quotations/quotation-pdf-a4";
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

  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type: "QUOTATION" },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const buffer = await renderToBuffer(
    settings.printFormat === "A4" ? (
      <QuotationPdfA4Document tenant={tenant} document={document} />
    ) : (
      <QuotationPdfDocument tenant={tenant} document={document} />
    )
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="quotation-${document.number}.pdf"`,
    },
  });
}
