import type { Customer, Document, DocumentLine, Product, PurchaseReceipt, PurchaseReceiptLine, StockMovement, Supplier, Tenant } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export interface GatheredTenantData {
  tenant: Tenant;
  customers: Customer[];
  products: Product[];
  suppliers: Supplier[];
  receipts: (Document & { customer: Customer; lines: DocumentLine[] })[];
  quotations: (Document & { customer: Customer; lines: DocumentLine[] })[];
  purchaseReceipts: (PurchaseReceipt & { lines: PurchaseReceiptLine[] })[];
  stockMovements: StockMovement[];
  summary: {
    receiptCount: number;
    quotationCount: number;
    earliestDocumentAt: Date | null;
    latestDocumentAt: Date | null;
  };
}

// Everything under one tenant, fetched once, in the exact shape the archive
// builder (Task 3) and the delete route's summary fields (Task 6) both need.
// Deliberately reads through withTenant() -- this only ever runs as part of
// the CTO-only delete flow, but there is no reason to bypass the same
// tenant-scoping guarantee every other query in this codebase relies on.
export async function gatherTenantData(tenantId: string): Promise<GatheredTenantData> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  const [customers, products, suppliers, allDocuments, purchaseReceipts, stockMovements] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.customer.findMany(),
      tx.product.findMany(),
      tx.supplier.findMany(),
      tx.document.findMany({ include: { customer: true, lines: true }, orderBy: { createdAt: "asc" } }),
      tx.purchaseReceipt.findMany({ include: { lines: true } }),
      tx.stockMovement.findMany(),
    ])
  );

  const receipts = allDocuments.filter((d) => d.type === "SALES_RECEIPT");
  const quotations = allDocuments.filter((d) => d.type === "QUOTATION");

  return {
    tenant,
    customers,
    products,
    suppliers,
    receipts,
    quotations,
    purchaseReceipts,
    stockMovements,
    summary: {
      receiptCount: receipts.length,
      quotationCount: quotations.length,
      earliestDocumentAt: allDocuments[0]?.createdAt ?? null,
      latestDocumentAt: allDocuments[allDocuments.length - 1]?.createdAt ?? null,
    },
  };
}
