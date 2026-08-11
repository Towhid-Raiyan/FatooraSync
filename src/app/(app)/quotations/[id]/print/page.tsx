import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { QuotationPrintThermal } from "@/components/quotations/quotation-print-thermal";
import { QuotationPrintA4 } from "@/components/quotations/quotation-print-a4";

export default async function QuotationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type: "QUOTATION" },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) {
    notFound();
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  if (settings.printFormat === "A4") {
    return <QuotationPrintA4 tenant={tenant} document={document} />;
  }
  return <QuotationPrintThermal tenant={tenant} document={document} />;
}
