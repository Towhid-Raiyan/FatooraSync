import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { assertCanManageCatalog } from "@/lib/rbac/require-catalog-access";
import { isForeignKeyViolation } from "@/lib/db/foreign-key-violation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const catalogBlocked = await assertCanManageCatalog(tenantId, session.user.role);
  if (catalogBlocked) return catalogBlocked;
  const { id } = await params;
  const body = await request.json();

  const existing = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id } }));
  if (!existing) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  if (existing.isWalkIn) {
    return NextResponse.json({ error: "The Walk-in Customer cannot be edited" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    data.name = name;
  }
  if (body.vatId !== undefined) data.vatId = body.vatId || null;
  if (body.crNumber !== undefined) data.crNumber = body.crNumber || null;
  if (body.phone !== undefined) data.phone = body.phone || null;
  if (body.address !== undefined) data.address = body.address || null;
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

  try {
    const customer = await withTenant(tenantId, (tx) => tx.customer.update({ where: { id }, data }));
    return NextResponse.json(customer);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "This VAT ID is already used by another customer" },
        { status: 409 }
      );
    }
    throw err;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const catalogBlocked = await assertCanManageCatalog(tenantId, session.user.role);
  if (catalogBlocked) return catalogBlocked;
  const { id } = await params;

  const existing = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id } }));
  if (!existing) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  if (existing.isWalkIn) {
    return NextResponse.json({ error: "The Walk-in Customer cannot be deleted" }, { status: 403 });
  }

  try {
    await withTenant(tenantId, (tx) => tx.customer.delete({ where: { id } }));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return NextResponse.json(
        { error: "This customer has receipts or quotations on record and can't be deleted" },
        { status: 409 }
      );
    }
    throw err;
  }
}
