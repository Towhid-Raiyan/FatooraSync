import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { assertCtoRole } from "@/lib/admin-auth/require-cto";
import { AUDIT_ACTIONS } from "@/lib/admin-auth/audit-actions";
import { writeAuditLog } from "@/lib/admin-auth/audit-log";
import { hashPassword } from "@/lib/auth/password";
import { isPasswordValid } from "@/lib/auth/password-rules";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      legalName: true,
      tradeNameEn: true,
      tradeNameAr: true,
      vatNumber: true,
      crNumber: true,
      phone: true,
      address: true,
      billingStatus: true,
      trialEndsAt: true,
      featureFlags: true,
      createdAt: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
    },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: tenant.id,
    legalName: tenant.legalName,
    tradeNameEn: tenant.tradeNameEn,
    tradeNameAr: tenant.tradeNameAr,
    vatNumber: tenant.vatNumber,
    crNumber: tenant.crNumber,
    phone: tenant.phone,
    address: tenant.address,
    billingStatus: tenant.billingStatus,
    trialEndsAt: tenant.trialEndsAt,
    featureFlags: tenant.featureFlags,
    createdAt: tenant.createdAt,
    ownerEmail: tenant.users[0]?.email ?? null,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const forbidden = assertCtoRole(session.user.role);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = await request.json();

  const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
  const tradeNameEn = typeof body.tradeNameEn === "string" ? body.tradeNameEn.trim() : "";
  const vatNumber = typeof body.vatNumber === "string" ? body.vatNumber.trim() : "";
  const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";

  if (!legalName || !tradeNameEn || !vatNumber || !ownerEmail) {
    return NextResponse.json(
      { error: "legalName, tradeNameEn, vatNumber, and ownerEmail are required" },
      { status: 400 }
    );
  }

  const ownerPassword = typeof body.ownerPassword === "string" ? body.ownerPassword : "";
  if (ownerPassword && !isPasswordValid(ownerPassword)) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters and include an uppercase letter, a number, and a special character" },
      { status: 400 }
    );
  }

  const owner = await prisma.user.findFirst({ where: { tenantId: id, role: "OWNER" } });
  if (!owner) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  try {
    const emailChanged = ownerEmail !== owner.email;
    const passwordChanged = ownerPassword.length > 0;

    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          legalName,
          tradeNameEn,
          tradeNameAr: typeof body.tradeNameAr === "string" ? body.tradeNameAr.trim() || null : null,
          vatNumber,
          crNumber: typeof body.crNumber === "string" ? body.crNumber.trim() || null : null,
          phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
          address: typeof body.address === "string" ? body.address.trim() || null : null,
        },
      });

      if (emailChanged || passwordChanged) {
        await tx.user.update({
          where: { id: owner.id },
          data: {
            ...(emailChanged ? { email: ownerEmail } : {}),
            ...(passwordChanged ? { passwordHash: await hashPassword(ownerPassword) } : {}),
          },
        });
      }
    });

    await writeAuditLog({
      agencyStaffId: session.user.agencyStaffId,
      action: AUDIT_ACTIONS.TENANT_UPDATED,
      tenantId: id,
      metadata: { tradeNameEn, ownerEmailChanged: emailChanged, ownerPasswordChanged: passwordChanged },
    });

    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "An account with this owner email already exists" }, { status: 409 });
    }
    throw err;
  }
}
