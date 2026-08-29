"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { isWithinRetentionWindow } from "@/lib/tenant-deletion/retention-window";

export interface TenantDeleteSummary {
  tradeNameEn: string;
  receiptCount: number;
  quotationCount: number;
  customerCount: number;
  productCount: number;
  latestDocumentAt: string | null;
}

// Deliberately stricter than the existing DeleteConfirmDialog
// (src/components/ui/delete-confirm-dialog.tsx, which has no typed
// confirmation step) -- this removes an entire client's history, not one
// product row, and the confirm button stays disabled until the exact trade
// name is typed.
export function TenantDeleteDialog({
  open,
  onOpenChange,
  tenant,
  deleting,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: TenantDeleteSummary;
  deleting: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const [typedName, setTypedName] = useState("");
  const nameMatches = typedName.trim() === tenant.tradeNameEn;
  const withinRetention = isWithinRetentionWindow(tenant.latestDocumentAt ? new Date(tenant.latestDocumentAt) : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        if (!next) setTypedName("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {tenant.tradeNameEn}?</DialogTitle>
          <DialogDescription>
            This permanently removes the client and everything under them from the live database. A full export is
            generated and archived before anything is deleted, and can be downloaded from the Deleted Clients list
            afterward.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Receipts</span>
            <span className="font-medium text-neutral-900">{tenant.receiptCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Quotations</span>
            <span className="font-medium text-neutral-900">{tenant.quotationCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Customers</span>
            <span className="font-medium text-neutral-900">{tenant.customerCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-neutral-500">Products</span>
            <span className="font-medium text-neutral-900">{tenant.productCount}</span>
          </div>
        </div>

        {withinRetention && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            This client has records from within the ~6-year VAT record-retention window. An export will still be
            made before deletion, but confirm this is intentional.
          </p>
        )}

        <label className="text-xs font-medium text-neutral-700">
          Type <span className="font-mono">{tenant.tradeNameEn}</span> to confirm
          <input
            type="text"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            disabled={deleting}
            className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-600"
          />
        </label>

        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting || !nameMatches} onClick={onConfirm}>
            {deleting && <Loader2Icon className="size-3.5 animate-spin" />}
            Delete Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
