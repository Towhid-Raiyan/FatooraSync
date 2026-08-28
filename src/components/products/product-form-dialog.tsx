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
import { offlineDb, type PendingProduct } from "@/lib/offline/db";
import { enqueuePendingProduct } from "@/lib/offline/product-outbox";
import { useOnlineStatus } from "@/lib/offline/connectivity";

// A temporary, clearly-marked stand-in for the real, server-assigned SKU
// (see PendingProduct's doc comment) -- formatted like a real code so it
// doesn't need translation and doesn't look broken in the Arabic UI, unlike
// an English placeholder phrase would.
const PENDING_SKU_PLACEHOLDER = "SKU-PENDING";

interface ProductFormDialogProps {
  open: boolean;
  product: SerializedProduct | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (product: SerializedProduct) => void;
  // When true, a genuine network failure while CREATING a new product (never
  // while editing an existing one -- that stays out of scope, see spec §2)
  // falls back to queuing it locally instead of just showing an error. Only
  // the quick-create dialog opened from New Receipt/New Quotation passes
  // this; the standalone Products management page leaves it unset, since
  // that page can't be reached offline in the first place.
  offlineCapable?: boolean;
}

function validateOfflineProduct(form: {
  nameEn: string;
  unitPrice: string;
  quantity: string;
  useDefaultVat: boolean;
  vatRate: string;
  lowStockThreshold: string;
}): string | null {
  // Mirrors src/app/api/products/route.ts's own validation exactly, since
  // there's no server to validate against while offline.
  if (!form.nameEn.trim()) return "English name is required";
  const unitPrice = Number(form.unitPrice);
  if (form.unitPrice === "" || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return "Unit price is required and must be zero or more";
  }
  if (form.quantity !== "") {
    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) return "Quantity must be zero or more";
  }
  if (!form.useDefaultVat && form.vatRate !== "") {
    const vatRate = Number(form.vatRate);
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) return "VAT rate must be between 0 and 100";
  }
  if (form.lowStockThreshold !== "") {
    const lowStockThreshold = Number(form.lowStockThreshold);
    if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) return "Low stock threshold must be zero or more";
  }
  return null;
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

export function ProductFormDialog({ open, product, onOpenChange, onSaved, offlineCapable }: ProductFormDialogProps) {
  const { dict } = useLocale();
  const online = useOnlineStatus();
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

    // Skip the network attempt entirely when already known offline (same
    // pattern as receipt-form.tsx/quotation-form.tsx) -- a genuinely offline
    // device shouldn't sit waiting on a doomed request before falling back.
    // `online` can still be stale/true for a request that then itself fails,
    // which the catch below covers the same way either path does.
    let response: Response | null = null;
    if (online || !offlineCapable || product) {
      try {
        response = await fetch(url, { method, body: JSON.stringify(payload) });
      } catch {
        response = null; // genuine network failure -- may fall through to the offline path below
      }
    }

    if (response) {
      const body = await response.json().catch(() => null);
      if (body === null) {
        setError(dict.common.somethingWentWrong);
        setSaving(false);
        return;
      }
      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        setSaving(false);
        return;
      }
      onSaved(body);
      setSaving(false);
      return;
    }

    // response is null: the request never reached the server. Only offer the
    // offline fallback for a genuinely new product on an offline-capable
    // caller -- editing an existing product offline stays out of scope.
    if (!offlineCapable || product) {
      setError(dict.common.somethingWentWrong);
      setSaving(false);
      return;
    }

    const validationError = validateOfflineProduct(form);
    if (validationError) {
      setError(validationError);
      setSaving(false);
      return;
    }

    const id = crypto.randomUUID();
    const nameAr = form.nameAr.trim() || null;
    const barcode = form.barcode.trim() || null;
    const vatRate = form.useDefaultVat ? null : form.vatRate;
    const lowStockThreshold = form.lowStockThreshold === "" ? null : form.lowStockThreshold;
    const quantity = form.quantity === "" ? "0" : form.quantity;
    const createdAt = new Date().toISOString();

    const pending: PendingProduct = {
      id,
      nameEn: form.nameEn.trim(),
      nameAr,
      barcode,
      unit: form.unit,
      unitPrice: form.unitPrice,
      vatRate,
      quantity,
      lowStockThreshold,
      createdAt,
    };
    await enqueuePendingProduct(pending);
    await offlineDb.products.put({
      id,
      nameEn: pending.nameEn,
      nameAr,
      sku: PENDING_SKU_PLACEHOLDER,
      barcode,
      unitPrice: form.unitPrice,
      vatRate,
      quantity,
      unit: form.unit,
      isActive: true,
    });

    onSaved({
      id,
      tenantId: "", // not read by any caller of onSaved -- fine to leave blank client-side
      nameEn: pending.nameEn,
      nameAr,
      sku: PENDING_SKU_PLACEHOLDER,
      barcode,
      unit: form.unit as SerializedProduct["unit"],
      unitPrice: form.unitPrice,
      vatRate,
      quantity,
      lowStockThreshold,
      isActive: true,
      createdAt: new Date(createdAt),
    });
    setSaving(false);
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
