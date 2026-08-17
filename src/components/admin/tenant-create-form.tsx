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

export function TenantCreateForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [createdTenant, setCreatedTenant] = useState<{ id: string; tradeNameEn: string; ownerEmail: string; ownerPassword: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const ownerEmail = String(form.get("ownerEmail") ?? "");
    const payload = {
      legalName: form.get("legalName"),
      tradeNameEn: form.get("tradeNameEn"),
      tradeNameAr: form.get("tradeNameAr"),
      vatNumber: form.get("vatNumber"),
      crNumber: form.get("crNumber"),
      phone: form.get("phone"),
      address: form.get("address"),
      ownerEmail,
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
      toast.success(`Client "${body.tradeNameEn}" created`);
      setCreatedTenant({ id: body.id, tradeNameEn: body.tradeNameEn, ownerEmail, ownerPassword: password });
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (createdTenant) {
    return <TenantCreatedPanel tenant={createdTenant} onContinue={() => router.push(`/admin/tenants/${createdTenant.id}`)} />;
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
        <div>
          <Field label="Owner email" name="ownerEmail" type="email" required />
          <p className="mt-1.5 text-[11px] text-neutral-400">
            Stored exactly as typed — the Owner&apos;s login is case-sensitive, so double-check capitalization.
          </p>
        </div>
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
          className="flex items-center gap-2 rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-70"
        >
          {saving && <Spinner />}
          {saving ? "Creating…" : "Create client"}
        </button>
      </div>
    </form>
  );
}

function TenantCreatedPanel({
  tenant,
  onContinue,
}: {
  tenant: { id: string; tradeNameEn: string; ownerEmail: string; ownerPassword: string };
  onContinue: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(tenant.ownerPassword);
      setCopied(true);
      toast.success("Password copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the text manually.");
    }
  }

  return (
    <div className="max-w-2xl rounded-xl border border-neutral-200 bg-white p-6">
      <p className="mb-1 text-sm font-bold text-green-800">✓ Client created</p>
      <p className="mb-5 text-sm text-neutral-500">
        {tenant.tradeNameEn} is ready. Share these Owner credentials now — the password will not be shown again.
      </p>

      <div className="mb-5 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Owner email</p>
          <p className="select-all rounded-md bg-white px-3 py-2 font-mono text-sm text-neutral-900">{tenant.ownerEmail}</p>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Owner password</p>
          <div className="flex gap-2">
            <p className="select-all flex-1 rounded-md bg-white px-3 py-2 font-mono text-sm text-neutral-900">{tenant.ownerPassword}</p>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-600 hover:border-green-700"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      <p className="mb-6 text-[11px] text-neutral-400">This password will not be shown again — copy it now before leaving this page.</p>

      <div className="flex justify-end border-t border-neutral-100 pt-5">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700"
        >
          Go to client
        </button>
      </div>
    </div>
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
