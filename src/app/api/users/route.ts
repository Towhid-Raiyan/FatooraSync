import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { hashPassword } from "@/lib/auth/password";
import { isPasswordValid } from "@/lib/auth/password-rules";
import { assertOwnerRole } from "@/lib/rbac/require-owner";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const forbidden = assertOwnerRole(session.user.role);
  if (forbidden) return forbidden;

  const body = await request.json();

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!isPasswordValid(password)) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters and include an uppercase letter, a number, and a special character" },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await withTenant(tenantId, (tx) =>
      tx.user.create({
        data: { email, passwordHash, role: "CASHIER" } as Prisma.UserUncheckedCreateInput,
      })
    );
    return NextResponse.json({ id: user.id, email: user.email, role: user.role, isActive: user.isActive }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "This email is already in use" }, { status: 409 });
    }
    throw err;
  }
}
