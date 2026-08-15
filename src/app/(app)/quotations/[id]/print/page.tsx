import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getQuotationPrintData } from "@/lib/quotations/get-print-data";
import { QuotationPrintThermal } from "@/components/quotations/quotation-print-thermal";
import { QuotationPrintA4 } from "@/components/quotations/quotation-print-a4";

export default async function QuotationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const data = await getQuotationPrintData(tenantId, id);
  if (!data) {
    notFound();
  }

  if (data.printFormat === "A4") {
    return <QuotationPrintA4 tenant={data.tenant} document={data.document} />;
  }
  return <QuotationPrintThermal tenant={data.tenant} document={data.document} />;
}
