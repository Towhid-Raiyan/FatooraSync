"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/language-provider";
import type { AdjustmentReason, InventoryProduct, SerializedMovement } from "./inventory-client";

interface AdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: InventoryProduct[];
  onSaved: (movement: SerializedMovement, updatedQuantity: string) => void;
}

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";
const REASONS: AdjustmentReason[] = ["DAMAGE", "LOSS_THEFT", "RECOUNT", "OTHER"];

export function AdjustDialog({ open, onOpenChange, products, onSaved }: AdjustDialogProps) {
  const { dict } = useLocale();
  const reasonLabels: Record<AdjustmentReason, string> = {
    DAMAGE: dict.inventory.reasonDamage,
    LOSS_THEFT: dict.inventory.reasonLossTheft,
    RECOUNT: dict.inventory.reasonRecount,
    OTHER: dict.inventory.reasonOther,
  };

  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState<AdjustmentReason>("DAMAGE");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setProductId(products[0]?.id ?? "");
      setReason("DAMAGE");
      setQuantity("");
      setNote("");
      setError(null);
      setSaving(false);
    }
  }, [open, products]);

  const selectedProduct = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const currentStock = selectedProduct ? Number(selectedProduct.quantity) : 0;
  const parsedQuantity = Number(quantity);
  const newStock = currentStock + (Number.isFinite(parsedQuantity) ? parsedQuantity : 0);
  const noteRequired = reason === "OTHER";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!productId) return;
    if (!Number.isFinite(parsedQuantity) || parsedQuantity === 0) {
      setError(dict.inventory.invalidQuantity);
      return;
    }
    if (noteRequired && !note.trim()) {
      setError(dict.inventory.noteRequiredError);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          productId,
          type: "ADJUSTMENT",
          quantity: parsedQuantity,
          reason,
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
          type: "ADJUSTMENT",
          quantityDelta: body.quantityDelta,
          quantityAfter: body.quantityAfter,
          reason: body.reason,
          note: body.note,
          unitCost: null,
          createdAt: body.createdAt,
          productId,
          product: body.product,
          supplier: body.supplier,
          createdByUser: body.createdByUser,
          document: null,
          purchaseReceipt: null,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.inventory.adjustDialogTitle}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div>
            <Label htmlFor="adjust-product" className={LABEL_CLASS}>
              {dict.inventory.product}
            </Label>
            <select
              id="adjust-product"
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
              <Label htmlFor="adjust-reason" className={LABEL_CLASS}>
                {dict.inventory.reason}
              </Label>
              <select
                id="adjust-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as AdjustmentReason)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {reasonLabels[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="adjust-quantity" className={LABEL_CLASS}>
                {dict.inventory.quantityChange}
              </Label>
              <Input
                id="adjust-quantity"
                type="number"
                step="0.001"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="adjust-note" className={LABEL_CLASS}>
              {noteRequired ? dict.inventory.noteRequired : dict.inventory.noteOptional}
            </Label>
            <textarea
              id="adjust-note"
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
              {saving ? dict.common.savingEllipsis : dict.inventory.saveAdjustment}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
