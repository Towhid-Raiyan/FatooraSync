"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { BarcodeScannerModal } from "@/components/barcode-scanner-modal";
import { useLocale } from "@/lib/i18n/language-provider";
import type { Dictionary } from "@/lib/i18n/dictionaries/dictionary.types";
import type { SerializedProduct } from "./products-client";

interface ProductFormDialogProps {
  open: boolean;
  product: SerializedProduct | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (product: SerializedProduct) => void;
}

export function getUnitOptions(dict: Dictionary): { value: string; label: string }[] {
  return [
    { value: "PIECE", label: dict.products.units.piece },
    { value: "KG", label: dict.products.units.kg },
    { value: "BOX", label: dict.products.units.box },
    { value: "CARTON", label: dict.products.units.carton },
    { value: "LITER", label: dict.products.units.liter },
    { value: "DOZEN", label: dict.products.units.dozen },
  ];
}

export function getUnitLabels(dict: Dictionary): Record<string, string> {
  return Object.fromEntries(getUnitOptions(dict).map((opt) => [opt.value, opt.label]));
}

const EMPTY_FORM = {
  nameEn: "",
  nameAr: "",
  barcode: "",
  unit: "PIECE",
  unitPrice: "",
  useDefaultVat: true,
  vatRate: "",
  quantity: "0",
  lowStockThreshold: "",
};

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function ProductFormDialog({ open, product, onOpenChange, onSaved }: ProductFormDialogProps) {
  const { dict } = useLocale();
  const unitOptions = getUnitOptions(dict);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

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
              lowStockThreshold: product.lowStockThreshold ?? "",
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
      lowStockThreshold: form.lowStockThreshold,
    };

    try {
      const response = await fetch(url, { method, body: JSON.stringify(payload) });
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? dict.products.dialogTitleEdit : dict.products.dialogTitleAdd}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="product-name-en" className={LABEL_CLASS}>
                {dict.products.nameEn}
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
                {dict.products.nameAr}
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
              {dict.products.barcode}
            </Label>
            <div className="flex gap-2">
              {/* A physical USB/Bluetooth scanner just types into this field like a
                  keyboard and ends with Enter -- the value is already correct by the
                  time Enter fires, so all that's needed here is stopping that Enter
                  from submitting the whole form before the rest of it is filled in. */}
              <Input
                id="product-barcode"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={dict.barcodeScanner.scanWithCamera}
                title={dict.barcodeScanner.scanWithCamera}
                onClick={() => setScannerOpen(true)}
              >
                <Camera className="size-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="product-unit" className={LABEL_CLASS}>
                {dict.products.unit}
              </Label>
              <select
                id="product-unit"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {unitOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="product-price" className={LABEL_CLASS}>
                {dict.products.unitPrice}
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

          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <label className="mb-1.5 flex items-center gap-2 text-xs text-body">
              <Checkbox
                checked={form.useDefaultVat}
                onCheckedChange={(checked) => setForm({ ...form, useDefaultVat: checked === true })}
              />
              {dict.products.useDefaultVat}
            </label>
            {!form.useDefaultVat && (
              <div>
                <Label htmlFor="product-vat-rate" className={LABEL_CLASS}>
                  {dict.products.vatRate}
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="product-quantity" className={LABEL_CLASS}>
                {dict.products.quantity}
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
            <div>
              <Label htmlFor="product-low-stock-threshold" className={LABEL_CLASS}>
                {dict.inventory.lowStockThreshold}
              </Label>
              <Input
                id="product-low-stock-threshold"
                type="number"
                step="0.001"
                min="0"
                value={form.lowStockThreshold}
                onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted-fg">{dict.inventory.lowStockThresholdHint}</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? dict.common.savingEllipsis : dict.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <BarcodeScannerModal
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onDetected={(code) => setForm((prev) => ({ ...prev, barcode: code }))}
      />
    </Dialog>
  );
}
