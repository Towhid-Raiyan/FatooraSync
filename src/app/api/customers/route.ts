import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { assertCanManageCatalog } from "@/lib/rbac/require-catalog-access";

// Not called by any UI in this codebase (both the Customers and the Sales Receipt
// pages fetch directly via withTenant instead) -- kept because the design spec
// mandates the endpoint's existence regardless of whether anything currently calls it.
export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const customers = await withTenant(tenantId, (tx) =>
    tx.customer.findMany({ orderBy: { name: "asc" } })
  );
  return NextResponse.json(customers);
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

  try {
    // tenantId is intentionally absent from data; it's injected by the withTenant extension.
    // The cast documents the known gap between the runtime guarantee and the static type.
    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.create({
        data: {
          name,
          vatId: body.vatId || null,
          crNumber: body.crNumber || null,
          phone: body.phone || null,
          address: body.address || null,
        } as Prisma.CustomerUncheckedCreateInput,
      })
    );
    return NextResponse.json(customer, { status: 201 });
  } catch (err) {
    // Customer's only unique constraint besides its id is @@unique([tenantId, vatId]),
    // so any P2002 from this create is necessarily a duplicate VAT ID within this tenant.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "This VAT ID is already used by another customer" },
        { status: 409 }
      );
    }
    throw err;
  }
}
