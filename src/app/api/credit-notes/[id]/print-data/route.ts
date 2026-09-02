import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { getDocumentPrintData } from "@/lib/receipts/get-print-data";

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

  return NextResponse.json({
    printFormat: data.printFormat,
    tenant: {
      tradeNameEn: data.tenant.tradeNameEn,
      tradeNameAr: data.tenant.tradeNameAr,
      legalName: data.tenant.legalName,
      vatNumber: data.tenant.vatNumber,
      crNumber: data.tenant.crNumber,
      phone: data.tenant.phone,
      address: data.tenant.address,
    },
    document: {
      number: data.document.number,
      createdAt: data.document.createdAt,
      subtotal: data.document.subtotal,
      vatTotal: data.document.vatTotal,
      grandTotal: data.document.grandTotal,
      notes: data.document.notes,
      customer: {
        name: data.document.customer.name,
        vatId: data.document.customer.vatId,
        crNumber: data.document.customer.crNumber,
        phone: data.document.customer.phone,
        address: data.document.customer.address,
      },
      lines: data.document.lines.map((line) => ({
        id: line.id,
        productName: line.productName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        lineVat: line.lineVat,
        lineTotal: line.lineTotal,
      })),
    },
    qrImageDataUrl: data.qrImageDataUrl,
  });
}
