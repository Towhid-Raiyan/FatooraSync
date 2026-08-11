import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { QuotationHistoryClient } from "@/components/quotations/quotation-history-client";
import { PAGE_SIZE } from "@/lib/receipts/constants";

export default async function QuotationHistoryPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const where = { type: "QUOTATION" as const };
  const [total, documents] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.count({ where }),
      tx.document.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE,
        select: {
          id: true,
          number: true,
          grandTotal: true,
          createdAt: true,
          customer: { select: { name: true, vatId: true } },
        },
      }),
    ])
  );

  const quotations = documents.map((doc) => ({
    id: doc.id,
    number: doc.number,
    customerName: doc.customer.name,
    customerVatId: doc.customer.vatId,
    createdAt: doc.createdAt.toISOString(),
    grandTotal: doc.grandTotal.toString(),
  }));

  return <QuotationHistoryClient initial={{ quotations, total, page: 1, pageSize: PAGE_SIZE }} />;
}
