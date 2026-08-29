import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const archives = await prisma.tenantArchive.findMany({
    select: { id: true, tradeNameEn: true, legalName: true, vatNumber: true, joinedAt: true, deletedAt: true, receiptCount: true, quotationCount: true },
    orderBy: { deletedAt: "desc" },
  });

  return NextResponse.json({ archives });
}
