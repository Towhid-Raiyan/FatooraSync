import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { assertOwnerRole } from "@/lib/rbac/require-owner";
import { getQuarterRange, getCurrentQuarter } from "@/lib/statistics/quarter-range";
import { getVatSummary } from "@/lib/statistics/get-vat-summary";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const ownerBlocked = assertOwnerRole(session.user.role);
  if (ownerBlocked) return ownerBlocked;

  const url = new URL(request.url);
  const current = getCurrentQuarter();
  const yearParam = Number(url.searchParams.get("year"));
  const quarterParam = Number(url.searchParams.get("quarter"));
  const year = Number.isFinite(yearParam) && yearParam >= 2000 && yearParam <= 2100 ? yearParam : current.year;
  const quarter =
    Number.isFinite(quarterParam) && quarterParam >= 1 && quarterParam <= 4
      ? quarterParam
      : current.quarter;

  const { start, end } = getQuarterRange(year, quarter);
  const { outgoingVat, incomingVat, netPayable } = await getVatSummary(tenantId, start, end);

  return NextResponse.json({ year, quarter, outgoingVat, incomingVat, netPayable });
}
