import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";

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
