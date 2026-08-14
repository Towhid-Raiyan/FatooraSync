import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { SettingsClient } from "@/components/settings/settings-client";
import { StaffSection } from "@/components/settings/staff-section";

export default async function SettingsPage() {
  const session = await auth();
  if (session!.user.role !== "OWNER") {
    redirect("/");
  }
  const tenantId = session!.user.tenantId;

  const cashiers = await withTenant(tenantId, (tx) =>
    tx.user.findMany({ where: { role: "CASHIER" }, orderBy: { email: "asc" } })
  );

  return (
    <div className="flex flex-col gap-6">
      <SettingsClient />
      <StaffSection initialCashiers={cashiers.map((c) => ({ id: c.id, email: c.email, isActive: c.isActive }))} />
    </div>
  );
}
