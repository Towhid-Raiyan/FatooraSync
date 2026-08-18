"use client";

import { useState } from "react";
import { PASSWORD_RULES, isPasswordValid } from "@/lib/auth/password-rules";
import { useToast } from "@/lib/toast/toast-provider";
import { Spinner } from "@/components/admin/spinner";

const RULE_LABELS: Record<string, string> = {
  minLength: "8+ characters",
  uppercase: "Uppercase letter",
  number: "Number",
  special: "Special character",
};

export function AccountSettingsForm() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newPasswordValid = isPasswordValid(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit = currentPassword.length > 0 && newPasswordValid && passwordsMatch;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!newPasswordValid) {
      setError("New password does not meet the requirements below.");
      return;
    }
    if (!passwordsMatch) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/account/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md rounded-xl border border-neutral-200 bg-white p-6">
      <p className="mb-4 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Change password</p>

      <div className="mb-3.5">
        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">Current password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
        />
      </div>

      <div className="mb-3.5">
        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">New password</label>
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
        />
        <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]">
          {PASSWORD_RULES.map((rule) => {
            const ok = rule.test(newPassword);
            return (
              <li key={rule.id} className={ok ? "text-green-800" : "text-neutral-400"}>
                {ok ? "✓" : "○"} {RULE_LABELS[rule.id]}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mb-6">
        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">Confirm new password</label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
        />
        {confirmPassword.length > 0 && !passwordsMatch && (
          <p className="mt-1.5 text-[11px] text-red-600">Passwords do not match.</p>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end border-t border-neutral-100 pt-5">
        <button
          type="submit"
          disabled={saving || !canSubmit}
          className="flex items-center gap-2 rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {saving && <Spinner />}
          {saving ? "Updating…" : "Update password"}
        </button>
      </div>
    </form>
  );
}
