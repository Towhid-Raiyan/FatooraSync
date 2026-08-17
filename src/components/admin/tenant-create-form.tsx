"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PASSWORD_RULES, isPasswordValid } from "@/lib/auth/password-rules";
import { useToast } from "@/lib/toast/toast-provider";

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

export function TenantCreateForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      legalName: form.get("legalName"),
      tradeNameEn: form.get("tradeNameEn"),
      tradeNameAr: form.get("tradeNameAr"),
      vatNumber: form.get("vatNumber"),
      crNumber: form.get("crNumber"),
      phone: form.get("phone"),
      address: form.get("address"),
      ownerEmail: form.get("ownerEmail"),
      ownerPassword: password,
    };

    if (!isPasswordValid(password)) {
      setError("Password does not meet the requirements below.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/tenants", { method: "POST", body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      toast.success(`Tenant "${body.tradeNameEn}" created`);
      router.push(`/admin/tenants/${body.id}`);
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl rounded-xl border border-neutral-200 bg-white p-6">
      <p className="mb-4 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Business details</p>
      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <Field label="Legal name" name="legalName" required />
        <Field label="VAT number" name="vatNumber" required mono />
        <Field label="Trade name (English)" name="tradeNameEn" required />
        <Field label="Trade name (Arabic)" name="tradeNameAr" dir="rtl" />
        <Field label="CR number" name="crNumber" mono />
        <Field label="Phone" name="phone" />
      </div>
      <Field label="Address" name="address" />

      <p className="mb-4 mt-6 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Owner account</p>
      <div className="mb-1 grid grid-cols-2 gap-3.5">
        <Field label="Owner email" name="ownerEmail" type="email" required />
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-neutral-600">Owner password</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
            />
            <button
              type="button"
              onClick={() => setPassword(randomPassword())}
              className="shrink-0 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-600 hover:border-green-700"
            >
              Generate
            </button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li key={rule.id} className={ok ? "text-green-800" : "text-neutral-400"}>
                  {ok ? "✓" : "○"} {RULE_LABELS[rule.id]}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="mb-6 text-[11px] text-neutral-400">No email is sent — you share these credentials with the Owner directly.</p>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="flex justify-end gap-2.5 border-t border-neutral-100 pt-5">
        <button
          type="button"
          onClick={() => router.push("/admin/tenants")}
          className="rounded-lg border border-neutral-200 px-4 py-2 text-[13px] font-semibold text-neutral-600"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create tenant"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  type = "text",
  mono,
  dir,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  mono?: boolean;
  dir?: "rtl" | "ltr";
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-neutral-600">
        {label} {required && <span className="font-normal text-neutral-400">required</span>}
      </label>
      <input
        name={name}
        type={type}
        dir={dir}
        className={`w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700 ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
