import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { StatusPill } from "@/components/admin/status-pill";
import { ClickableRow } from "@/components/admin/clickable-row";

const STATUS_ORDER = ["TRIALING", "ACTIVE", "COMPLIMENTARY", "PAST_DUE", "SUSPENDED"] as const;
const STATUS_BAR_COLOR: Record<string, string> = {
  TRIALING: "#D97706",
  ACTIVE: "#15803D",
  COMPLIMENTARY: "#1D4ED8",
  PAST_DUE: "#DC2626",
  SUSPENDED: "#991B1B",
};

export default async function AdminDashboardPage() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, tradeNameEn: true, billingStatus: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const counts: Record<string, number> = {};
  for (const t of tenants) counts[t.billingStatus] = (counts[t.billingStatus] ?? 0) + 1;
  const total = tenants.length;
  const needsAttention = (counts.PAST_DUE ?? 0) + (counts.SUSPENDED ?? 0);
  const recent = tenants.slice(0, 5);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-7 sm:py-8">
      <h1 className="text-xl font-bold text-neutral-900">Overview</h1>
      <p className="mb-6 text-sm text-neutral-500">Where the business stands right now</p>

      <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-extrabold text-neutral-900">{total}</div>
          <div className="text-[11.5px] font-semibold text-neutral-500">Total clients</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-extrabold text-green-800">{counts.ACTIVE ?? 0}</div>
          <div className="text-[11.5px] font-semibold text-neutral-500">Active</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-extrabold text-amber-700">{counts.TRIALING ?? 0}</div>
          <div className="text-[11.5px] font-semibold text-neutral-500">Trialing</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-extrabold text-red-700">{needsAttention}</div>
          <div className="text-[11.5px] font-semibold text-neutral-500">Needs attention</div>
        </div>
      </div>

      {total > 0 && (
        <div className="mb-7">
          <p className="mb-2.5 text-[13px] font-bold text-neutral-900">Status breakdown</p>
          <div className="rounded-xl border border-neutral-200 bg-white p-5">
            <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
              {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
                <div key={s} style={{ width: `${((counts[s] ?? 0) / total) * 100}%`, background: STATUS_BAR_COLOR[s] }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-4 text-[11.5px] text-neutral-600">
              {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full" style={{ background: STATUS_BAR_COLOR[s] }} />
                  {s} ({counts[s]})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2.5 text-[13px] font-bold text-neutral-900">Recently added clients</p>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {recent.length === 0 ? (
            <p className="py-8 text-center text-xs text-neutral-400">No clients yet.</p>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-[13px]">
                  <tbody>
                    {recent.map((t) => (
                      <ClickableRow key={t.id} href={`/admin/tenants/${t.id}`}>
                        <td className="px-4 py-3 font-semibold text-neutral-900">{t.tradeNameEn}</td>
                        <td className="px-4 py-3">
                          <StatusPill status={t.billingStatus} />
                        </td>
                        <td className="px-4 py-3 text-neutral-500">{t.createdAt.toLocaleDateString()}</td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-neutral-100 md:hidden">
                {recent.map((t) => (
                  <li key={t.id}>
                    <Link href={`/admin/tenants/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0 truncate font-semibold text-neutral-900">{t.tradeNameEn}</span>
                      <span className="flex shrink-0 items-center gap-2.5">
                        <StatusPill status={t.billingStatus} />
                        <span className="text-[12px] text-neutral-400">{t.createdAt.toLocaleDateString()}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
