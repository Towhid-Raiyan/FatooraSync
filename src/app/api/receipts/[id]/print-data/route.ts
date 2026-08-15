import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { getReceiptPrintData } from "@/lib/receipts/get-print-data";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const data = await getReceiptPrintData(tenantId, id);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
