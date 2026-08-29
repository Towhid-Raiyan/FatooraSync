"use client";

import Link from "next/link";

export interface ArchivedTenantRow {
  id: string;
  tradeNameEn: string;
  legalName: string;
  vatNumber: string;
  joinedAt: string;
  deletedAt: string;
  receiptCount: number;
  quotationCount: number;
}

export function DeletedTenantsList({ archives }: { archives: ArchivedTenantRow[] }) {
  if (archives.length === 0) {
    return <p className="py-10 text-center text-xs text-neutral-400">No clients have been deleted.</p>;
  }

  return (
    <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {archives.map((a) => (
        <li key={a.id}>
          <Link href={`/admin/tenants/deleted/${a.id}`} className="block px-4 py-3 hover:bg-neutral-50">
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-neutral-900">{a.tradeNameEn}</div>
                <div className="truncate text-[12px] text-neutral-400">{a.legalName}</div>
              </div>
              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
                Deleted
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-neutral-500">
              <span className="font-mono">{a.vatNumber}</span>
              <span>
                {a.receiptCount} receipt{a.receiptCount === 1 ? "" : "s"}, {a.quotationCount} quotation
                {a.quotationCount === 1 ? "" : "s"}
              </span>
              <span className="text-neutral-400">Deleted {new Date(a.deletedAt).toLocaleDateString()}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
