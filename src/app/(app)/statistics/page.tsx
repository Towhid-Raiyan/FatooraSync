import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { StatisticsClient } from "@/components/statistics/statistics-client";
import { getQuarterRange, getCurrentQuarter } from "@/lib/statistics/quarter-range";
import { getVatSummary } from "@/lib/statistics/get-vat-summary";

export default async function StatisticsPage() {
  const session = await auth();
  if (session!.user.role !== "OWNER") {
    redirect("/");
  }
  const tenantId = session!.user.tenantId;
  const current = getCurrentQuarter();
  const { start, end } = getQuarterRange(current.year, current.quarter);
  const { outgoingVat, incomingVat, netPayable } = await getVatSummary(tenantId, start, end);

  return (
    <StatisticsClient
      initial={{ year: current.year, quarter: current.quarter, outgoingVat, incomingVat, netPayable }}
    />
  );
}
