import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { assertCanManageCatalog } from "@/lib/rbac/require-catalog-access";

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const suppliers = await withTenant(tenantId, (tx) =>
    tx.supplier.findMany({ orderBy: { name: "asc" } })
  );
  return NextResponse.json(suppliers);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const catalogBlocked = await assertCanManageCatalog(tenantId, session.user.role);
  if (catalogBlocked) return catalogBlocked;
  const body = await request.json();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const supplier = await withTenant(tenantId, (tx) =>
    tx.supplier.create({
      data: {
        name,
        vatId: body.vatId || null,
        crNumber: body.crNumber || null,
        phone: body.phone || null,
        address: body.address || null,
      } as Prisma.SupplierUncheckedCreateInput,
    })
  );
  return NextResponse.json(supplier, { status: 201 });
}
