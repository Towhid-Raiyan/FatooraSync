import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { getCreditableLines } from "@/lib/receipts/creditable-lines";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const result = await getCreditableLines(tenantId, id);
  if (!result) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
