import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { StatisticsClient } from "@/components/statistics/statistics-client";
import { getQuarterRange, getCurrentQuarter } from "@/lib/statistics/quarter-range";

export default async function StatisticsPage() {
  const session = await auth();
  if (session!.user.role !== "OWNER") {
    redirect("/");
  }
  const tenantId = session!.user.tenantId;
  const current = getCurrentQuarter();
  const { start, end } = getQuarterRange(current.year, current.quarter);

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

  return (
    <StatisticsClient
      initial={{ year: current.year, quarter: current.quarter, outgoingVat, incomingVat, netPayable }}
    />
  );
}
