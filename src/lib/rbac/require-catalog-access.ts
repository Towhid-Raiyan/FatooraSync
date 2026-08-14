import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db/tenant-context";

export async function assertCanManageCatalog(tenantId: string, role: string | undefined): Promise<NextResponse | null> {
  if (role === "OWNER") return null;

  const settings = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
  if (!settings.cashierCanManageCatalog) {
    return NextResponse.json({ error: "Your Owner has restricted this to Owner-only" }, { status: 403 });
  }
  return null;
}
