import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { assertCtoRole } from "@/lib/admin-auth/require-cto";

// Deliberately tighter than the list/detail archive routes (which stay open
// to any staff role per spec S7): this route uniquely returns the complete
// archive -- every customer's PII and invoice history for the deleted
// tenant -- not just summary/identity fields.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const forbidden = assertCtoRole(session.user.role);
  if (forbidden) return forbidden;

  const { id } = await params;
  const archive = await prisma.tenantArchive.findUnique({ where: { id }, select: { archiveUrl: true, tradeNameEn: true } });
  if (!archive) {
    return NextResponse.json({ error: "Archive not found" }, { status: 404 });
  }

  const blobResponse = await fetch(archive.archiveUrl);
  if (!blobResponse.ok || !blobResponse.body) {
    return NextResponse.json({ error: "Archive could not be retrieved" }, { status: 502 });
  }

  return new NextResponse(blobResponse.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archive.tradeNameEn.replace(/[^a-zA-Z0-9-]/g, "-")}-archive.zip"`,
    },
  });
}
