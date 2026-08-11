import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { ReceiptHistoryClient } from "@/components/receipts/receipt-history-client";

const PAGE_SIZE = 10;

export default async function ReceiptHistoryPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const where = { type: "SALES_RECEIPT" as const };
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

  const receipts = documents.map((doc) => ({
    id: doc.id,
    number: doc.number,
    customerName: doc.customer.name,
    customerVatId: doc.customer.vatId,
    createdAt: doc.createdAt.toISOString(),
    grandTotal: doc.grandTotal.toString(),
  }));

  return <ReceiptHistoryClient initial={{ receipts, total, page: 1, pageSize: PAGE_SIZE }} />;
}
