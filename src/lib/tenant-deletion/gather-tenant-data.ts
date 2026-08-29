import type { Customer, Document, DocumentLine, NumberLease, Product, PurchaseReceipt, PurchaseReceiptLine, Settings, StockMovement, Supplier, Tenant } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

// Only the fields safe to export -- never passwordHash. Selected explicitly
// (rather than filtered out after a full fetch) so a future field added to
// User doesn't silently end up in an exported archive.
export interface SafeUser {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
}

export interface GatheredTenantData {
  tenant: Tenant;
  settings: Settings | null;
  users: SafeUser[];
  customers: Customer[];
  products: Product[];
  suppliers: Supplier[];
  receipts: (Document & { customer: Customer; lines: DocumentLine[] })[];
  quotations: (Document & { customer: Customer; lines: DocumentLine[] })[];
  purchaseReceipts: (PurchaseReceipt & { lines: PurchaseReceiptLine[] })[];
  stockMovements: StockMovement[];
  numberLeases: NumberLease[];
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

  const [settings, users, customers, products, suppliers, allDocuments, purchaseReceipts, stockMovements, numberLeases] = await withTenant(
    tenantId,
    (tx) =>
      Promise.all([
        tx.settings.findUnique({ where: { tenantId } }),
        tx.user.findMany({
          select: { id: true, tenantId: true, email: true, role: true, isActive: true, createdAt: true },
        }),
        tx.customer.findMany(),
        tx.product.findMany(),
        tx.supplier.findMany(),
        tx.document.findMany({ include: { customer: true, lines: true }, orderBy: { createdAt: "asc" } }),
        tx.purchaseReceipt.findMany({ include: { lines: true } }),
        tx.stockMovement.findMany(),
        // NumberLease is deliberately not in TENANT_SCOPED_MODELS (see
        // tenant-context.ts) -- every call site, including this one, must
        // filter by tenantId explicitly rather than relying on auto-injection.
        tx.numberLease.findMany({ where: { tenantId } }),
      ])
  );

  const receipts = allDocuments.filter((d) => d.type === "SALES_RECEIPT");
  const quotations = allDocuments.filter((d) => d.type === "QUOTATION");

  return {
    tenant,
    settings,
    users,
    customers,
    products,
    suppliers,
    receipts,
    quotations,
    purchaseReceipts,
    stockMovements,
    numberLeases,
    summary: {
      receiptCount: receipts.length,
      quotationCount: quotations.length,
      earliestDocumentAt: allDocuments[0]?.createdAt ?? null,
      latestDocumentAt: allDocuments[allDocuments.length - 1]?.createdAt ?? null,
    },
  };
}
