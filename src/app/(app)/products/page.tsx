import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { ProductsClient } from "@/components/products/products-client";

export default async function ProductsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [products, settings] = await Promise.all([
    withTenant(tenantId, (tx) => tx.product.findMany({ orderBy: { nameEn: "asc" } })),
    withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } })),
  ]);
  const canManageCatalog = session!.user.role === "OWNER" || settings.cashierCanManageCatalog;

  // Decimal fields (unitPrice, vatRate, quantity) can't cross the Server -> Client
  // Component boundary as raw Prisma Decimal instances -- convert to strings first.
  // See this plan's Global Constraints for why.
  const serialized = products.map((p) => ({
    ...p,
    unitPrice: p.unitPrice.toString(),
    vatRate: p.vatRate?.toString() ?? null,
    quantity: p.quantity.toString(),
  }));

  return <ProductsClient initialProducts={serialized} canManageCatalog={canManageCatalog} />;
}
