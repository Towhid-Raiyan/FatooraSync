import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { SuppliersClient } from "@/components/suppliers/suppliers-client";

export default async function SuppliersPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [suppliers, settings] = await Promise.all([
    withTenant(tenantId, (tx) => tx.supplier.findMany({ orderBy: { name: "asc" } })),
    withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } })),
  ]);
  const canManageCatalog = session!.user.role === "OWNER" || settings.cashierCanManageCatalog;

  return <SuppliersClient initialSuppliers={suppliers} canManageCatalog={canManageCatalog} />;
}
