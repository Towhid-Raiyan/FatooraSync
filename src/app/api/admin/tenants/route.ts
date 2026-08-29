import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { seedTenant } from "@/lib/db/seed-tenant";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { assertCtoRole } from "@/lib/admin-auth/require-cto";
import { AUDIT_ACTIONS } from "@/lib/admin-auth/audit-actions";
import { writeAuditLog } from "@/lib/admin-auth/audit-log";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim();
  const tenants = await prisma.tenant.findMany({
    where: q
      ? { OR: [{ tradeNameEn: { contains: q, mode: "insensitive" } }, { vatNumber: { contains: q } }] }
      : undefined,
    select: {
      id: true,
      legalName: true,
      tradeNameEn: true,
      vatNumber: true,
      billingStatus: true,
      createdAt: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    tenants: tenants.map((t) => ({
      id: t.id,
      legalName: t.legalName,
      tradeNameEn: t.tradeNameEn,
      vatNumber: t.vatNumber,
      billingStatus: t.billingStatus,
      createdAt: t.createdAt,
      ownerEmail: t.users[0]?.email ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const forbidden = assertCtoRole(session.user.role);
  if (forbidden) return forbidden;

  const body = await request.json();

  const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
  const tradeNameEn = typeof body.tradeNameEn === "string" ? body.tradeNameEn.trim() : "";
  const vatNumber = typeof body.vatNumber === "string" ? body.vatNumber.trim() : "";
  const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";
  const ownerPassword = typeof body.ownerPassword === "string" ? body.ownerPassword : "";

  if (!legalName || !tradeNameEn || !vatNumber || !ownerEmail || !ownerPassword) {
    return NextResponse.json(
      { error: "legalName, tradeNameEn, vatNumber, ownerEmail, and ownerPassword are required" },
      { status: 400 }
    );
  }

  try {
    const result = await seedTenant({
      legalName,
      tradeNameEn,
      tradeNameAr: typeof body.tradeNameAr === "string" ? body.tradeNameAr.trim() || undefined : undefined,
      vatNumber,
      crNumber: typeof body.crNumber === "string" ? body.crNumber.trim() || undefined : undefined,
      phone: typeof body.phone === "string" ? body.phone.trim() || undefined : undefined,
      address: typeof body.address === "string" ? body.address.trim() || undefined : undefined,
      ownerEmail,
      ownerPassword,
    });

    const matchingArchive = await prisma.tenantArchive.findFirst({
      where: { vatNumber },
      select: { id: true, tradeNameEn: true, deletedAt: true },
      orderBy: { deletedAt: "desc" },
    });

    await writeAuditLog({
      agencyStaffId: session.user.agencyStaffId,
      action: AUDIT_ACTIONS.TENANT_CREATED,
      tenantId: result.tenant.id,
      metadata: { tradeNameEn: result.tenant.tradeNameEn, ownerEmail: result.user.email },
    });

    return NextResponse.json(
      { id: result.tenant.id, tradeNameEn: result.tenant.tradeNameEn, vatNumber: result.tenant.vatNumber, matchingArchive },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "An account with this owner email already exists" }, { status: 409 });
    }
    throw err;
  }
}
