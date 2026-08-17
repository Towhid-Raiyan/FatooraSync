"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/admin/status-pill";
import { ClickableRow } from "@/components/admin/clickable-row";

export interface TenantRow {
  id: string;
  legalName: string;
  tradeNameEn: string;
  vatNumber: string;
  billingStatus: string;
  createdAt: string | Date;
  ownerEmail: string | null;
}

export function TenantsListClient({ initialTenants }: { initialTenants: TenantRow[] }) {
  const [query, setQuery] = useState("");
  const [tenants, setTenants] = useState<TenantRow[]>(initialTenants);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setTenants(initialTenants);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/tenants?q=${encodeURIComponent(trimmed)}`);
        if (!response.ok) return;
        const body = await response.json();
        setTenants(body.tenants);
      } catch {
        // Leave the previously displayed list in place on network errors.
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [query, initialTenants]);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or VAT number…"
        className="mb-4 w-full max-w-sm rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
      />

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {tenants.length === 0 ? (
          <p className="py-10 text-center text-xs text-neutral-400">
            {query.trim() ? "No clients match your search." : "No clients yet — create the first one."}
          </p>
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
                <ClickableRow key={t.id} href={`/admin/tenants/${t.id}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-neutral-900">{t.tradeNameEn}</div>
                    <div className="text-[12px] text-neutral-400">{t.legalName}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-neutral-600">{t.vatNumber}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.billingStatus} />
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{t.ownerEmail ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-400">{new Date(t.createdAt).toLocaleDateString()}</td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
