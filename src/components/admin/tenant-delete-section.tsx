"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TenantDeleteDialog, type TenantDeleteSummary } from "@/components/admin/tenant-delete-dialog";

export function TenantDeleteSection({ tenantId, summary }: { tenantId: string; summary: TenantDeleteSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}/delete`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Something went wrong");
        setDeleting(false);
        return;
      }
      router.push("/admin/tenants");
    } catch {
      setError("Something went wrong");
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <h2 className="mb-1 text-sm font-bold text-red-900">Danger Zone</h2>
      <p className="mb-3 text-xs text-red-700">
        Permanently delete this client and everything under them, after archiving a full export.
      </p>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete Client
      </Button>
      <TenantDeleteDialog
        open={open}
        onOpenChange={setOpen}
        tenant={summary}
        deleting={deleting}
        error={error}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
