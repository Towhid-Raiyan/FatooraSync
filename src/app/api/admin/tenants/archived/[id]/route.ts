import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const archive = await prisma.tenantArchive.findUnique({
    where: { id },
    select: {
      id: true,
      originalTenantId: true,
      legalName: true,
      tradeNameEn: true,
      tradeNameAr: true,
      vatNumber: true,
      crNumber: true,
      phone: true,
      address: true,
      joinedAt: true,
      deletedAt: true,
      deletedByAgencyStaffId: true,
      receiptCount: true,
      quotationCount: true,
      earliestDocumentAt: true,
      latestDocumentAt: true,
    },
  });
  if (!archive) {
    return NextResponse.json({ error: "Archive not found" }, { status: 404 });
  }

  return NextResponse.json(archive);
}
