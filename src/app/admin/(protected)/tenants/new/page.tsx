import Link from "next/link";
import { TenantCreateForm } from "@/components/admin/tenant-create-form";

export default function AdminNewTenantPage() {
  return (
    <div className="mx-auto max-w-2xl px-7 py-8">
      <div className="mb-1 text-xs text-neutral-400">
        <Link href="/admin/tenants" className="hover:text-green-800">
          Clients
        </Link>{" "}
        / New
      </div>
      <h1 className="mb-1 text-xl font-bold text-neutral-900">New client</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Creates the shop and its Owner account in one step — same as the seed script, from a screen.
      </p>
      <TenantCreateForm />
    </div>
  );
}
