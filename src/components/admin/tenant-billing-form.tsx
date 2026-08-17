"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/toast/toast-provider";

const STATUSES = ["TRIALING", "ACTIVE", "COMPLIMENTARY", "PAST_DUE", "SUSPENDED"];

export function TenantBillingForm({
  tenantId,
  initialStatus,
  initialTrialEndsAt,
  initialFeatureFlags,
}: {
  tenantId: string;
  initialStatus: string;
  initialTrialEndsAt: string | null;
  initialFeatureFlags: unknown;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState(initialStatus);
  const [trialEndsAt, setTrialEndsAt] = useState(initialTrialEndsAt ?? "");
  const [flagsText, setFlagsText] = useState(JSON.stringify(initialFeatureFlags ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    let featureFlags: unknown;
    try {
      featureFlags = JSON.parse(flagsText || "{}");
    } catch {
      setError("Feature flags must be valid JSON.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}/billing`, {
        method: "PATCH",
        body: JSON.stringify({
          billingStatus: status,
          trialEndsAt: status === "TRIALING" ? trialEndsAt || null : null,
          featureFlags,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      toast.success("Billing status updated · audit log entry written");
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="mb-4 text-[13px] font-bold text-neutral-900">Billing &amp; access</p>

      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">Billing status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-neutral-400">
          SUSPENDED blocks the tenant&apos;s app immediately — checked server-side on every page load, not just at login.
        </p>
      </div>

      <div className="mb-4" style={{ opacity: status === "TRIALING" ? 1 : 0.4 }}>
        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">
          Trial ends <span className="font-normal text-neutral-400">only used while TRIALING</span>
        </label>
        <input
          type="date"
          value={trialEndsAt ? trialEndsAt.slice(0, 10) : ""}
          onChange={(e) => setTrialEndsAt(e.target.value)}
          disabled={status !== "TRIALING"}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700 disabled:bg-neutral-50"
        />
      </div>

      <div className="mb-2">
        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">
          Feature flags <span className="font-normal text-neutral-400">optional, JSON</span>
        </label>
        <textarea
          value={flagsText}
          onChange={(e) => setFlagsText(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs outline-none focus:border-green-700"
        />
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-4 flex justify-end border-t border-neutral-100 pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <p className="mt-4 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3 text-[11.5px] leading-relaxed text-neutral-500">
        <span className="font-semibold text-neutral-600">Recorded, not yet browsable:</span> saving this writes a{" "}
        <code className="font-mono">BILLING_STATUS_CHANGED</code> row to the audit log (who, what, when) — the Audit
        Log screen to browse it is a later pass.
      </p>
    </div>
  );
}
