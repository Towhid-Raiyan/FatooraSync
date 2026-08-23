import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
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

  const purchaseReceipt = await withTenant(tenantId, (txn) =>
    txn.purchaseReceipt.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true, vatId: true, crNumber: true, phone: true } },
        lines: { orderBy: { id: "asc" } },
      },
    })
  );
  if (!purchaseReceipt) {
    return NextResponse.json({ error: "Purchase receipt not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: purchaseReceipt.id,
    number: purchaseReceipt.number,
    supplierReceiptNumber: purchaseReceipt.supplierReceiptNumber,
    purchaseDate: purchaseReceipt.purchaseDate.toISOString(),
    paymentMethod: purchaseReceipt.paymentMethod,
    subtotal: purchaseReceipt.subtotal.toString(),
    vatTotal: purchaseReceipt.vatTotal.toString(),
    grandTotal: purchaseReceipt.grandTotal.toString(),
    supplier: purchaseReceipt.supplier,
    lines: purchaseReceipt.lines.map((line) => ({
      id: line.id,
      productName: line.productName,
      unit: line.unit,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toString(),
      vatRate: line.vatRate.toString(),
      lineSubtotal: line.lineSubtotal.toString(),
      lineVat: line.lineVat.toString(),
      lineTotal: line.lineTotal.toString(),
    })),
  });
}
