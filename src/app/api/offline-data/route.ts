import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

// Everything /receipts/new and /quotations/new need to render and let a
// cashier build a sale, bundled for the client-side offline cache
// (src/lib/offline/cache-sync.ts). Deliberately shared by both document
// types -- the underlying data (catalog, customers, settings, tenant info)
// is identical regardless of what's being created from it.
export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const [customers, products, settings, tenant] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      tx.product.findMany({ where: { isActive: true }, orderBy: { nameEn: "asc" } }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { tradeNameEn: true, tradeNameAr: true, legalName: true, vatNumber: true, crNumber: true, phone: true, address: true },
      }),
    ])
  );

  const serializedProducts = products.map((p) => ({
    ...p,
    unitPrice: p.unitPrice.toString(),
    vatRate: p.vatRate?.toString() ?? null,
    quantity: p.quantity.toString(),
    lowStockThreshold: p.lowStockThreshold?.toString() ?? null,
  }));

  return NextResponse.json({
    products: serializedProducts,
    customers,
    settings: { defaultVatRate: settings.defaultVatRate.toString(), printFormat: settings.printFormat },
    tenant,
  });
}
