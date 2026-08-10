"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@prisma/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CustomerFormDialogProps {
  open: boolean;
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (customer: Customer) => void;
}

const EMPTY_FORM = { name: "", vatId: "", crNumber: "", phone: "", address: "" };
const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function CustomerFormDialog({ open, customer, onOpenChange, onSaved }: CustomerFormDialogProps) {
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
    }
  }, [open, customer]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = customer ? `/api/customers/${customer.id}` : "/api/customers";
    const method = customer ? "PATCH" : "POST";

    const response = await fetch(url, { method, body: JSON.stringify(form) });
    const body = await response.json();
    setSaving(false);

    if (!response.ok) {
      setError(body.error ?? "Something went wrong");
      return;
    }
    onSaved(body);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{customer ? "Edit Customer" : "Add Customer"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div>
            <Label htmlFor="customer-name" className={LABEL_CLASS}>
              Name
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
              VAT ID
            </Label>
            <Input id="customer-vat" value={form.vatId} onChange={(e) => setForm({ ...form, vatId: e.target.value })} />
          </div>

          <div>
            <Label htmlFor="customer-cr" className={LABEL_CLASS}>
              CR Number
            </Label>
            <Input
              id="customer-cr"
              value={form.crNumber}
              onChange={(e) => setForm({ ...form, crNumber: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="customer-phone" className={LABEL_CLASS}>
              Phone
            </Label>
            <Input id="customer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>

          <div>
            <Label htmlFor="customer-address" className={LABEL_CLASS}>
              Address
            </Label>
            <Input
              id="customer-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
