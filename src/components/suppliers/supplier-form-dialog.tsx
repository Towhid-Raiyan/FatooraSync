"use client";

import { useEffect, useState } from "react";
import type { Supplier } from "@prisma/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/language-provider";

interface SupplierFormDialogProps {
  open: boolean;
  supplier: Supplier | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (supplier: Supplier) => void;
}

const EMPTY_FORM = { name: "", vatId: "", crNumber: "", phone: "", address: "" };
const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function SupplierFormDialog({ open, supplier, onOpenChange, onSaved }: SupplierFormDialogProps) {
  const { dict } = useLocale();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        supplier
          ? {
              name: supplier.name,
              vatId: supplier.vatId ?? "",
              crNumber: supplier.crNumber ?? "",
              phone: supplier.phone ?? "",
              address: supplier.address ?? "",
            }
          : EMPTY_FORM
      );
      setError(null);
      setSaving(false);
    }
  }, [open, supplier]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = supplier ? `/api/suppliers/${supplier.id}` : "/api/suppliers";
    const method = supplier ? "PATCH" : "POST";

    try {
      const response = await fetch(url, { method, body: JSON.stringify(form) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      onSaved(body);
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supplier ? dict.suppliers.dialogTitleEdit : dict.suppliers.dialogTitleAdd}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div>
            <Label htmlFor="supplier-name" className={LABEL_CLASS}>
              {dict.suppliers.name}
            </Label>
            <Input id="supplier-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="supplier-vat" className={LABEL_CLASS}>
                {dict.suppliers.vatId}
              </Label>
              <Input id="supplier-vat" value={form.vatId} onChange={(e) => setForm({ ...form, vatId: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="supplier-cr" className={LABEL_CLASS}>
                {dict.suppliers.crNumber}
              </Label>
              <Input id="supplier-cr" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} />
            </div>
          </div>

          <div>
            <Label htmlFor="supplier-phone" className={LABEL_CLASS}>
              {dict.suppliers.phone}
            </Label>
            <Input id="supplier-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>

          <div>
            <Label htmlFor="supplier-address" className={LABEL_CLASS}>
              {dict.suppliers.address}
            </Label>
            <Input
              id="supplier-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? dict.common.savingEllipsis : dict.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
