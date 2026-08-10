import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { CustomersClient } from "@/components/customers/customers-client";

export default async function CustomersPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const customers = await withTenant(tenantId, (tx) => tx.customer.findMany({ orderBy: { name: "asc" } }));

  return <CustomersClient initialCustomers={customers} />;
}
