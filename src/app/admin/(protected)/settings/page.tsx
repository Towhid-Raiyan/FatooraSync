import { AccountSettingsForm } from "@/components/admin/account-settings-form";

export default function AdminSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-7 sm:py-8">
      <h1 className="mb-1 text-xl font-bold text-neutral-900">Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">Manage your own admin account.</p>
      <AccountSettingsForm />
    </div>
  );
}
