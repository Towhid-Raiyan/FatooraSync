import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { StatusPill } from "@/components/admin/status-pill";

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

  return (
    <div className="mx-auto max-w-5xl px-7 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Tenants</h1>
          <p className="text-sm text-neutral-500">Every shop running on FatooraSync</p>
        </div>
        <Link
          href="/admin/tenants/new"
          className="rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700"
        >
          + New Tenant
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {tenants.length === 0 ? (
          <p className="py-10 text-center text-xs text-neutral-400">No tenants yet — create the first one.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">VAT Number</th>
                <th className="px-4 py-3">Billing status</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/tenants/${t.id}`} className="block">
                      <div className="font-semibold text-neutral-900">{t.tradeNameEn}</div>
                      <div className="text-[12px] text-neutral-400">{t.legalName}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-neutral-600">{t.vatNumber}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.billingStatus} />
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{t.users[0]?.email ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-400">{t.createdAt.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
