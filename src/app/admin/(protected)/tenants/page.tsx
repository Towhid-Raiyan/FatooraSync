import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { TenantsListClient } from "@/components/admin/tenants-list-client";

export default async function AdminTenantsPage() {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      legalName: true,
      tradeNameEn: true,
      vatNumber: true,
      billingStatus: true,
      createdAt: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  const initialTenants = tenants.map((t) => ({
    id: t.id,
    legalName: t.legalName,
    tradeNameEn: t.tradeNameEn,
    vatNumber: t.vatNumber,
    billingStatus: t.billingStatus,
    createdAt: t.createdAt,
    ownerEmail: t.users[0]?.email ?? null,
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-7 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Clients</h1>
          <p className="text-sm text-neutral-500">Every shop running on FatooraSync</p>
        </div>
        <Link
          href="/admin/tenants/new"
          className="self-start rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 sm:self-auto"
        >
          + New Client
        </Link>
      </div>

      <TenantsListClient initialTenants={initialTenants} />
    </div>
  );
}
