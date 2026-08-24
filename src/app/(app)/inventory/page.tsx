import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { InventoryClient } from "@/components/inventory/inventory-client";
import { PAGE_SIZE } from "@/lib/receipts/constants";

export default async function InventoryPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [movements, products, suppliers, settings, purchaseReceiptTotal, purchaseReceipts] = await Promise.all([
    withTenant(tenantId, (tx) =>
      tx.stockMovement.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          product: { select: { nameEn: true, nameAr: true, sku: true } },
          supplier: { select: { name: true } },
          createdByUser: { select: { email: true } },
          document: { select: { type: true, number: true } },
          purchaseReceipt: { select: { number: true } },
        },
      })
    ),
    withTenant(tenantId, (tx) =>
      tx.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          sku: true,
          barcode: true,
          unit: true,
          unitPrice: true,
          vatRate: true,
          quantity: true,
          lowStockThreshold: true,
        },
        orderBy: { nameEn: "asc" },
      })
    ),
    withTenant(tenantId, (tx) =>
      tx.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    ),
    withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } })),
    withTenant(tenantId, (tx) => tx.purchaseReceipt.count()),
    withTenant(tenantId, (tx) =>
      tx.purchaseReceipt.findMany({
        orderBy: { purchaseDate: "desc" },
        take: PAGE_SIZE,
        select: {
          id: true,
          number: true,
          supplierReceiptNumber: true,
          purchaseDate: true,
          paymentMethod: true,
          grandTotal: true,
          supplier: { select: { name: true } },
        },
      })
    ),
  ]);
  const isOwner = session!.user.role === "OWNER";
  const canManageCatalog = isOwner || settings.cashierCanManageCatalog;

  const serializedMovements = movements.map((m) => ({
    id: m.id,
    type: m.type,
    quantityDelta: m.quantityDelta.toString(),
    quantityAfter: m.quantityAfter.toString(),
    reason: m.reason,
    note: m.note,
    // Cost is owner-only information -- never sent to a Cashier session, not just
    // hidden client-side, so it can't be read out of the page payload or API response.
    unitCost: isOwner ? m.unitCost?.toString() ?? null : null,
    createdAt: m.createdAt.toISOString(),
    productId: m.productId,
    product: m.product,
    supplier: m.supplier,
    createdByUser: m.createdByUser,
    document: m.document,
    purchaseReceipt: m.purchaseReceipt,
  }));

  const serializedProducts = products.map((p) => ({
    id: p.id,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    sku: p.sku,
    barcode: p.barcode,
    unit: p.unit,
    unitPrice: p.unitPrice.toString(),
    vatRate: p.vatRate?.toString() ?? null,
    quantity: p.quantity.toString(),
    lowStockThreshold: p.lowStockThreshold?.toString() ?? null,
  }));

  const initialPurchaseReceipts = {
    receipts: purchaseReceipts.map((pr) => ({
      id: pr.id,
      number: pr.number,
      supplierReceiptNumber: pr.supplierReceiptNumber,
      supplierName: pr.supplier.name,
      purchaseDate: pr.purchaseDate.toISOString(),
      paymentMethod: pr.paymentMethod,
      grandTotal: pr.grandTotal.toString(),
    })),
    total: purchaseReceiptTotal,
    page: 1,
    pageSize: PAGE_SIZE,
  };

  return (
    <InventoryClient
      initialMovements={serializedMovements}
      products={serializedProducts}
      initialSuppliers={suppliers}
      initialPurchaseReceipts={initialPurchaseReceipts}
      canManageCatalog={canManageCatalog}
    />
  );
}
