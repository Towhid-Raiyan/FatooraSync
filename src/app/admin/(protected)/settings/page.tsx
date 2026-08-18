import { AccountSettingsForm } from "@/components/admin/account-settings-form";

export default function AdminSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-7 py-8">
      <h1 className="mb-1 text-xl font-bold text-neutral-900">Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">Manage your own admin account.</p>
      <AccountSettingsForm />
    </div>
  );
}
