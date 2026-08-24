"use client";

import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/language-provider";

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  details,
  error,
  deleting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  details: { label: string; value: string }[];
  error: string | null;
  deleting: boolean;
  onConfirm: () => void;
}) {
  const { dict } = useLocale();

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border-subtle bg-bg-app p-3 text-sm">
          {details.map((detail) => (
            <div key={detail.label} className="flex justify-between gap-3">
              <span className="text-muted-fg">{detail.label}</span>
              <span className="text-end font-medium text-heading">{detail.value}</span>
            </div>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            {dict.common.cancel}
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={onConfirm}>
            {deleting && <Loader2Icon className="size-3.5 animate-spin" />}
            {dict.common.confirmDelete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
