"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PASSWORD_RULES, isPasswordValid } from "@/lib/auth/password-rules";
import { useToast } from "@/lib/toast/toast-provider";
import { Spinner } from "@/components/admin/spinner";

const RULE_LABELS: Record<string, string> = {
  minLength: "8+ characters",
  uppercase: "Uppercase letter",
  number: "Number",
  special: "Special character",
};

function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let pw = "";
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

export interface TenantInfo {
  legalName: string;
  tradeNameEn: string;
  tradeNameAr: string | null;
  vatNumber: string;
  crNumber: string | null;
  phone: string | null;
  address: string | null;
  createdAt: string;
  ownerEmail: string;
}

export function TenantInfoForm({ tenantId, initial }: { tenantId: string; initial: TenantInfo }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState({
    legalName: initial.legalName,
    tradeNameEn: initial.tradeNameEn,
    tradeNameAr: initial.tradeNameAr ?? "",
    vatNumber: initial.vatNumber,
    crNumber: initial.crNumber ?? "",
    phone: initial.phone ?? "",
    address: initial.address ?? "",
    ownerEmail: initial.ownerEmail,
  });
  const [ownerPassword, setOwnerPassword] = useState("");

  function startEdit() {
    setFields({
      legalName: initial.legalName,
      tradeNameEn: initial.tradeNameEn,
      tradeNameAr: initial.tradeNameAr ?? "",
      vatNumber: initial.vatNumber,
      crNumber: initial.crNumber ?? "",
      phone: initial.phone ?? "",
      address: initial.address ?? "",
      ownerEmail: initial.ownerEmail,
    });
    setOwnerPassword("");
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setError(null);
    if (ownerPassword && !isPasswordValid(ownerPassword)) {
      setError("Password does not meet the requirements below.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...fields, ownerPassword: ownerPassword || undefined }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      toast.success("Client info updated · audit log entry written");
      setEditing(false);
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[13px] font-bold text-neutral-900">Business info</p>
          <button
            type="button"
            onClick={startEdit}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-600 hover:border-green-700"
          >
            Edit
          </button>
        </div>
        <InfoRow label="Legal name" value={initial.legalName} />
        <InfoRow label="Trade name (English)" value={initial.tradeNameEn} />
        <InfoRow label="Trade name (Arabic)" value={initial.tradeNameAr ?? "—"} />
        <InfoRow label="VAT number" value={initial.vatNumber} mono />
        <InfoRow label="CR number" value={initial.crNumber ?? "—"} mono />
        <InfoRow label="Phone" value={initial.phone ?? "—"} />
        <InfoRow label="Address" value={initial.address ?? "—"} />
        <InfoRow label="Created" value={new Date(initial.createdAt).toLocaleDateString()} />
        <InfoRow label="Owner email" value={initial.ownerEmail} />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="mb-4 text-[13px] font-bold text-neutral-900">Business info</p>

      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <EditField label="Legal name" value={fields.legalName} onChange={(v) => setFields((f) => ({ ...f, legalName: v }))} />
        <EditField label="VAT number" value={fields.vatNumber} onChange={(v) => setFields((f) => ({ ...f, vatNumber: v }))} mono />
        <EditField
          label="Trade name (English)"
          value={fields.tradeNameEn}
          onChange={(v) => setFields((f) => ({ ...f, tradeNameEn: v }))}
        />
        <EditField
          label="Trade name (Arabic)"
          value={fields.tradeNameAr}
          onChange={(v) => setFields((f) => ({ ...f, tradeNameAr: v }))}
          dir="rtl"
        />
        <EditField label="CR number" value={fields.crNumber} onChange={(v) => setFields((f) => ({ ...f, crNumber: v }))} mono />
        <EditField label="Phone" value={fields.phone} onChange={(v) => setFields((f) => ({ ...f, phone: v }))} />
      </div>
      <EditField label="Address" value={fields.address} onChange={(v) => setFields((f) => ({ ...f, address: v }))} />

      <p className="mb-4 mt-6 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Owner account</p>
      <div>
        <EditField
          label="Owner email"
          type="email"
          value={fields.ownerEmail}
          onChange={(v) => setFields((f) => ({ ...f, ownerEmail: v }))}
        />
        <p className="mb-3.5 mt-1.5 text-[11px] text-neutral-400">
          Stored exactly as typed — the Owner&apos;s login is case-sensitive, so double-check capitalization.
        </p>

        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">
          New owner password <span className="font-normal text-neutral-400">optional — leave blank to keep the current one</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={ownerPassword}
            onChange={(e) => setOwnerPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
          />
          <button
            type="button"
            onClick={() => setOwnerPassword(randomPassword())}
            className="shrink-0 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-600 hover:border-green-700"
          >
            Generate
          </button>
        </div>
        {ownerPassword && (
          <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(ownerPassword);
              return (
                <li key={rule.id} className={ok ? "text-green-800" : "text-neutral-400"}>
                  {ok ? "✓" : "○"} {RULE_LABELS[rule.id]}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <p role="alert" className="mb-3 mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-5 flex justify-end gap-2.5 border-t border-neutral-100 pt-4">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-lg border border-neutral-200 px-4 py-2 text-[13px] font-semibold text-neutral-600"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-70"
        >
          {saving && <Spinner />}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <p className="mt-4 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3 text-[11.5px] leading-relaxed text-neutral-500">
        <span className="font-semibold text-neutral-600">Recorded, not yet browsable:</span> saving this writes a{" "}
        <code className="font-mono">TENANT_UPDATED</code> row to the audit log — the Audit Log screen to browse it is a later
        pass.
      </p>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-neutral-100 py-2.5 text-[13px] last:border-0">
      <span className="shrink-0 text-neutral-400">{label}</span>
      <span className={`text-right font-semibold text-neutral-900 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = "text",
  mono,
  dir,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  mono?: boolean;
  dir?: "rtl" | "ltr";
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-neutral-600">{label}</label>
      <input
        type={type}
        value={value}
        dir={dir}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700 ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
