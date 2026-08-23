import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { assertOwnerRole } from "@/lib/rbac/require-owner";
import { getQuarterRange, getCurrentQuarter } from "@/lib/statistics/quarter-range";

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

  const [outgoing, incoming] = await withTenant(tenantId, (txn) =>
    Promise.all([
      txn.document.aggregate({
        where: { type: "SALES_RECEIPT", createdAt: { gte: start, lte: end } },
        _sum: { vatTotal: true },
      }),
      txn.purchaseReceipt.aggregate({
        where: { purchaseDate: { gte: start, lte: end } },
        _sum: { vatTotal: true },
      }),
    ])
  );

  const outgoingVat = outgoing._sum.vatTotal?.toString() ?? "0";
  const incomingVat = incoming._sum.vatTotal?.toString() ?? "0";
  const netPayable = (Number(outgoingVat) - Number(incomingVat)).toFixed(2);

  return NextResponse.json({ year, quarter, outgoingVat, incomingVat, netPayable });
}
