import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;

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
  const body = await request.json();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  try {
    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.create({
        data: {
          name,
          vatId: body.vatId || null,
          crNumber: body.crNumber || null,
          phone: body.phone || null,
          address: body.address || null,
        },
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
