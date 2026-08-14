import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { CustomersClient } from "@/components/customers/customers-client";

export default async function CustomersPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [customers, settings] = await Promise.all([
    withTenant(tenantId, (tx) => tx.customer.findMany({ orderBy: { name: "asc" } })),
    withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } })),
  ]);
  const canManageCatalog = session!.user.role === "OWNER" || settings.cashierCanManageCatalog;

  return <CustomersClient initialCustomers={customers} canManageCatalog={canManageCatalog} />;
}
