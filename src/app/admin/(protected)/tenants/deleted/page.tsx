import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { DeletedTenantsList } from "@/components/admin/deleted-tenants-list";

export default async function DeletedTenantsPage() {
  const archives = await prisma.tenantArchive.findMany({
    select: { id: true, tradeNameEn: true, legalName: true, vatNumber: true, joinedAt: true, deletedAt: true, receiptCount: true, quotationCount: true },
    orderBy: { deletedAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-7 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Deleted Clients</h1>
          <p className="text-sm text-neutral-500">Archived clients whose data has been removed from the live database</p>
        </div>
        <Link href="/admin/tenants" className="text-[13px] font-semibold text-green-800 hover:text-green-700">
          ← Back to Clients
        </Link>
      </div>

      <DeletedTenantsList
        archives={archives.map((a) => ({
          ...a,
          joinedAt: a.joinedAt.toISOString(),
          deletedAt: a.deletedAt.toISOString(),
        }))}
      />
    </div>
  );
}
