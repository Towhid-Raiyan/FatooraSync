import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { hashPassword } from "@/lib/auth/password";
import { isStaffPasswordValid, MIN_STAFF_PASSWORD_LENGTH } from "@/lib/auth/staff-password";
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

  const hasIsActive = body.isActive !== undefined;
  const hasEmail = body.email !== undefined;
  const hasPassword = body.password !== undefined;

  if (hasIsActive && typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
  }

  let email: string | undefined;
  if (hasEmail) {
    email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email) {
      return NextResponse.json({ error: "Username or email is required" }, { status: 400 });
    }
  }

  let passwordHash: string | undefined;
  if (hasPassword) {
    const password = typeof body.password === "string" ? body.password : "";
    if (!isStaffPasswordValid(password)) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_STAFF_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }
    passwordHash = await hashPassword(password);
  }

  if (!hasIsActive && !hasEmail && !hasPassword) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const existing = await withTenant(tenantId, (tx) => tx.user.findUnique({ where: { id } }));
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (existing.role !== "CASHIER") {
    return NextResponse.json({ error: "Only Cashier accounts can be managed here" }, { status: 403 });
  }

  try {
    const user = await withTenant(tenantId, (tx) =>
      tx.user.update({
        where: { id },
        data: {
          ...(hasIsActive ? { isActive: body.isActive as boolean } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(passwordHash !== undefined ? { passwordHash } : {}),
        },
      })
    );
    return NextResponse.json({ id: user.id, email: user.email, role: user.role, isActive: user.isActive });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "This username or email is already in use" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const existing = await withTenant(tenantId, (tx) => tx.user.findUnique({ where: { id } }));
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (existing.role !== "CASHIER") {
    return NextResponse.json({ error: "Only Cashier accounts can be managed here" }, { status: 403 });
  }

  await withTenant(tenantId, async (tx) => {
    // Session is unused today (auth is JWT-based, see the schema comment) but
    // deleting any stray rows first keeps this safe if that ever changes --
    // User.sessions has no onDelete: Cascade, so a leftover row would
    // otherwise turn this into a foreign-key-violation 500.
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.user.delete({ where: { id } });
  });

  return new NextResponse(null, { status: 204 });
}
