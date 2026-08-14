import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { assertOwnerRole } from "@/lib/rbac/require-owner";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const forbidden = assertOwnerRole(session.user.role);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = await request.json();
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
  }

  const existing = await withTenant(tenantId, (tx) => tx.user.findUnique({ where: { id } }));
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (existing.role !== "CASHIER") {
    return NextResponse.json({ error: "Only Cashier accounts can be deactivated here" }, { status: 403 });
  }

  const user = await withTenant(tenantId, (tx) => tx.user.update({ where: { id }, data: { isActive: body.isActive } }));
  return NextResponse.json({ id: user.id, email: user.email, role: user.role, isActive: user.isActive });
}
