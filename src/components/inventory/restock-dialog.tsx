"use client";

import { useEffect, useMemo, useState } from "react";
import type { Supplier } from "@prisma/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/language-provider";
import { SupplierFormDialog } from "@/components/suppliers/supplier-form-dialog";
import type { InventoryProduct, SerializedMovement } from "./inventory-client";

export interface SupplierOption {
  id: string;
  name: string;
}

interface RestockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: InventoryProduct[];
  suppliers: SupplierOption[];
  onSupplierCreated: (supplier: Supplier) => void;
  onSaved: (movement: SerializedMovement, updatedQuantity: string) => void;
}

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function RestockDialog({ open, onOpenChange, products, suppliers, onSupplierCreated, onSaved }: RestockDialogProps) {
  const { dict } = useLocale();
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setProductId(products[0]?.id ?? "");
      setQuantity("");
      setUnitCost("");
      setSupplierId("");
      setNote("");
      setError(null);
      setSaving(false);
    }
  }, [open, products]);

  const selectedProduct = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const currentStock = selectedProduct ? Number(selectedProduct.quantity) : 0;
  const parsedQuantity = Number(quantity);
  const newStock = currentStock + (Number.isFinite(parsedQuantity) ? parsedQuantity : 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!productId) return;
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError(dict.inventory.invalidQuantity);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          productId,
          type: "RESTOCK",
          quantity: parsedQuantity,
          unitCost: unitCost || undefined,
          supplierId: supplierId || undefined,
          note: note || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      onSaved(
        {
          id: body.id,
          type: "RESTOCK",
          quantityDelta: body.quantityDelta,
          quantityAfter: body.quantityAfter,
          reason: null,
          note: body.note,
          unitCost: body.unitCost,
          createdAt: body.createdAt,
          productId,
          product: body.product,
          supplier: body.supplier,
          createdByUser: body.createdByUser,
          document: null,
        },
        body.quantityAfter
      );
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.inventory.restockDialogTitle}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <div>
              <Label htmlFor="restock-product" className={LABEL_CLASS}>
                {dict.inventory.product}
              </Label>
              <select
                id="restock-product"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameEn} — {p.quantity}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="restock-quantity" className={LABEL_CLASS}>
                  {dict.inventory.quantityReceived}
                </Label>
                <Input
                  id="restock-quantity"
                  type="number"
                  step="0.001"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="restock-cost" className={LABEL_CLASS}>
                  {dict.inventory.unitCostOptional}
                </Label>
                <Input
                  id="restock-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="restock-supplier" className={LABEL_CLASS}>
                {dict.inventory.supplierOptional}
              </Label>
              <div className="flex gap-2">
                <select
                  id="restock-supplier"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" onClick={() => setSupplierDialogOpen(true)}>
                  {dict.inventory.newSupplier}
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="restock-note" className={LABEL_CLASS}>
                {dict.inventory.noteOptional}
              </Label>
              <textarea
                id="restock-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-input bg-transparent p-2.5 text-sm"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-dashed border-border-subtle bg-bg-app px-3 py-2.5 text-xs text-body">
              <span>
                {dict.inventory.currentStock} <b className="text-heading">{currentStock}</b>
              </span>
              <span>
                {dict.inventory.newStock} <b className="text-heading">{newStock}</b>
              </span>
            </div>

            <DialogFooter>
              <Button type="submit" variant="primary" disabled={saving || !productId}>
                {saving ? dict.common.savingEllipsis : dict.inventory.saveRestock}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SupplierFormDialog
        open={supplierDialogOpen}
        supplier={null}
        onOpenChange={setSupplierDialogOpen}
        onSaved={(supplier) => {
          onSupplierCreated(supplier);
          setSupplierId(supplier.id);
          setSupplierDialogOpen(false);
        }}
      />
    </>
  );
}
