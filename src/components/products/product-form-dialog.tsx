"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { SerializedProduct } from "./products-client";

interface ProductFormDialogProps {
  open: boolean;
  product: SerializedProduct | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (product: SerializedProduct) => void;
}

export const UNIT_OPTIONS = [
  { value: "PIECE", label: "Piece" },
  { value: "KG", label: "KG" },
  { value: "BOX", label: "Box" },
  { value: "CARTON", label: "Carton" },
  { value: "LITER", label: "Liter" },
];

export const UNIT_LABELS: Record<string, string> = Object.fromEntries(
  UNIT_OPTIONS.map((opt) => [opt.value, opt.label])
);

const EMPTY_FORM = {
  nameEn: "",
  nameAr: "",
  barcode: "",
  unit: "PIECE",
  unitPrice: "",
  useDefaultVat: true,
  vatRate: "",
  quantity: "0",
};

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function ProductFormDialog({ open, product, onOpenChange, onSaved }: ProductFormDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        product
          ? {
              nameEn: product.nameEn,
              nameAr: product.nameAr ?? "",
              barcode: product.barcode ?? "",
              unit: product.unit,
              unitPrice: product.unitPrice,
              useDefaultVat: product.vatRate === null,
              vatRate: product.vatRate ?? "",
              quantity: product.quantity,
            }
          : EMPTY_FORM
      );
      setError(null);
      setSaving(false);
    }
  }, [open, product]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = product ? `/api/products/${product.id}` : "/api/products";
    const method = product ? "PATCH" : "POST";
    const payload = {
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      barcode: form.barcode,
      unit: form.unit,
      unitPrice: form.unitPrice,
      vatRate: form.useDefaultVat ? null : form.vatRate,
      quantity: form.quantity,
    };

    try {
      const response = await fetch(url, { method, body: JSON.stringify(payload) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Something went wrong");
        return;
      }
      onSaved(body);
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? "Edit Product" : "Add Product"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-name-en" className={LABEL_CLASS}>
                Name (English)
              </Label>
              <Input
                id="product-name-en"
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="product-name-ar" className={LABEL_CLASS}>
                Name (Arabic)
              </Label>
              <Input
                id="product-name-ar"
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="product-barcode" className={LABEL_CLASS}>
              Barcode
            </Label>
            <Input
              id="product-barcode"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-unit" className={LABEL_CLASS}>
                Unit
              </Label>
              <select
                id="product-unit"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {UNIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="product-price" className={LABEL_CLASS}>
                Unit Price
              </Label>
              <Input
                id="product-price"
                type="number"
                step="0.01"
                min="0"
                value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 items-end gap-3">
            <label className="mb-1.5 flex items-center gap-2 text-xs text-body">
              <Checkbox
                checked={form.useDefaultVat}
                onCheckedChange={(checked) => setForm({ ...form, useDefaultVat: checked === true })}
              />
              Use default VAT rate
            </label>
            {!form.useDefaultVat && (
              <div>
                <Label htmlFor="product-vat-rate" className={LABEL_CLASS}>
                  VAT Rate (%)
                </Label>
                <Input
                  id="product-vat-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.vatRate}
                  onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
                />
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="product-quantity" className={LABEL_CLASS}>
              Quantity
            </Label>
            <Input
              id="product-quantity"
              type="number"
              step="0.001"
              min="0"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
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
