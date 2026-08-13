"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@prisma/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/language-provider";

interface CustomerFormDialogProps {
  open: boolean;
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (customer: Customer) => void;
}

const EMPTY_FORM = { name: "", vatId: "", crNumber: "", phone: "", address: "" };
const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function CustomerFormDialog({ open, customer, onOpenChange, onSaved }: CustomerFormDialogProps) {
  const { dict } = useLocale();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        customer
          ? {
              name: customer.name,
              vatId: customer.vatId ?? "",
              crNumber: customer.crNumber ?? "",
              phone: customer.phone ?? "",
              address: customer.address ?? "",
            }
          : EMPTY_FORM
      );
      setError(null);
      setSaving(false);
    }
  }, [open, customer]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = customer ? `/api/customers/${customer.id}` : "/api/customers";
    const method = customer ? "PATCH" : "POST";

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
          <DialogTitle>{customer ? dict.customers.dialogTitleEdit : dict.customers.dialogTitleAdd}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div>
            <Label htmlFor="customer-name" className={LABEL_CLASS}>
              {dict.customers.name}
            </Label>
            <Input
              id="customer-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="customer-vat" className={LABEL_CLASS}>
              {dict.customers.vatId}
            </Label>
            <Input id="customer-vat" value={form.vatId} onChange={(e) => setForm({ ...form, vatId: e.target.value })} />
          </div>

          <div>
            <Label htmlFor="customer-cr" className={LABEL_CLASS}>
              {dict.customers.crNumber}
            </Label>
            <Input
              id="customer-cr"
              value={form.crNumber}
              onChange={(e) => setForm({ ...form, crNumber: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="customer-phone" className={LABEL_CLASS}>
              {dict.customers.phone}
            </Label>
            <Input id="customer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>

          <div>
            <Label htmlFor="customer-address" className={LABEL_CLASS}>
              {dict.customers.address}
            </Label>
            <Input
              id="customer-address"
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
