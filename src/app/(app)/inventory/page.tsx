import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { InventoryClient } from "@/components/inventory/inventory-client";

export default async function InventoryPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [movements, products, suppliers, settings] = await Promise.all([
    withTenant(tenantId, (tx) =>
      tx.stockMovement.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          product: { select: { nameEn: true, nameAr: true, sku: true } },
          supplier: { select: { name: true } },
          createdByUser: { select: { email: true } },
          document: { select: { type: true, number: true } },
        },
      })
    ),
    withTenant(tenantId, (tx) =>
      tx.product.findMany({
        where: { isActive: true },
        select: { id: true, nameEn: true, nameAr: true, sku: true, quantity: true, lowStockThreshold: true },
        orderBy: { nameEn: "asc" },
      })
    ),
    withTenant(tenantId, (tx) =>
      tx.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    ),
    withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } })),
  ]);
  const canManageCatalog = session!.user.role === "OWNER" || settings.cashierCanManageCatalog;

  const serializedMovements = movements.map((m) => ({
    id: m.id,
    type: m.type,
    quantityDelta: m.quantityDelta.toString(),
    quantityAfter: m.quantityAfter.toString(),
    reason: m.reason,
    note: m.note,
    unitCost: m.unitCost?.toString() ?? null,
    createdAt: m.createdAt.toISOString(),
    productId: m.productId,
    product: m.product,
    supplier: m.supplier,
    createdByUser: m.createdByUser,
    document: m.document,
  }));

  const serializedProducts = products.map((p) => ({
    id: p.id,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    sku: p.sku,
    quantity: p.quantity.toString(),
    lowStockThreshold: p.lowStockThreshold?.toString() ?? null,
  }));

  return (
    <InventoryClient
      initialMovements={serializedMovements}
      products={serializedProducts}
      initialSuppliers={suppliers}
      canManageCatalog={canManageCatalog}
    />
  );
}
