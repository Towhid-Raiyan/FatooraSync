"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import type { SerializedProduct } from "@/components/products/products-client";
import { round2, calculateLine, calculateDocumentTotals, deriveUnitPriceFromTotal } from "@/lib/receipts/calculate-totals";
import { CustomerSection, type CustomerDraft } from "@/components/receipts/customer-section";
import { ItemsSection, type ReceiptLine } from "@/components/receipts/items-section";

const EMPTY_CUSTOMER_DRAFT: CustomerDraft = { name: "", vatId: "", crNumber: "", phone: "", address: "" };

interface QuotationFormProps {
  initialCustomers: Customer[];
  initialProducts: SerializedProduct[];
  defaultVatRate: string;
}

export function QuotationForm({ initialCustomers, initialProducts, defaultVatRate }: QuotationFormProps) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [products, setProducts] = useState(initialProducts);

  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT);

  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [notes, setNotes] = useState("");
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineTotals = useMemo(
    () =>
      lines.map((line) =>
        calculateLine({
          unitPrice: round2(Number(line.unitPrice)),
          quantity: Number(line.quantity),
          vatRate: Number(line.vatRate ?? defaultVatRate),
          discount: Number(line.discount),
        })
      ),
    [lines, defaultVatRate]
  );
  const documentTotals = useMemo(() => calculateDocumentTotals(lineTotals), [lineTotals]);

  function addLine(product: SerializedProduct) {
    setLines((prev) => [
      ...prev,
      {
        key: `${product.id}-${prev.length}-${Date.now()}`,
        productId: product.id,
        sku: product.sku,
        productName: product.nameEn,
        productNameAr: product.nameAr,
        unit: product.unit,
        quantity: "1",
        unitPrice: product.unitPrice,
        discount: "0",
        vatRate: product.vatRate,
        stockAtAdd: product.quantity,
      },
    ]);
  }

  function handleQuickCreateSaved(product: SerializedProduct) {
    setProducts((prev) => [...prev, product]);
    addLine(product);
    setQuickCreateOpen(false);
  }

  function handleUnitPriceChange(key: string, unitPrice: string) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, unitPrice } : line)));
  }

  function handleTotalChange(key: string, rawTotal: string) {
    const newTotal = Number(rawTotal);
    if (!Number.isFinite(newTotal) || newTotal < 0) return;
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const quantity = Number(line.quantity);
        if (!(quantity > 0)) return line;
        const vatRate = Number(line.vatRate ?? defaultVatRate);
        const unitPrice = deriveUnitPriceFromTotal({
          lineTotal: newTotal,
          quantity,
          discount: Number(line.discount),
          vatRate,
        });
        return { ...line, unitPrice: unitPrice.toFixed(2) };
      })
    );
  }

  function resetForm() {
    setCustomerDraft(EMPTY_CUSTOMER_DRAFT);
    setLines([]);
    setNotes("");
    setError(null);
  }

  async function handleSave(printAfter: boolean) {
    if (lines.length === 0) {
      setError("Add at least one item");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      customer: customerDraft,
      lines: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discount: line.discount,
        unitPrice: line.unitPrice,
      })),
      notes,
    };

    try {
      const response = await fetch("/api/quotations", { method: "POST", body: JSON.stringify(payload) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Something went wrong");
        setSaving(false);
        return;
      }

      const trimmedName = customerDraft.name.trim();
      const trimmedVatId = customerDraft.vatId.trim();
      if (trimmedName && trimmedVatId) {
        setCustomers((prev) => {
          if (prev.some((c) => c.vatId === trimmedVatId)) return prev;
          return [
            ...prev,
            {
              id: body.customerId,
              tenantId: "",
              name: trimmedName,
              vatId: trimmedVatId,
              crNumber: customerDraft.crNumber.trim() || null,
              phone: customerDraft.phone.trim() || null,
              address: customerDraft.address.trim() || null,
              isWalkIn: false,
              isActive: true,
              createdAt: new Date(),
            },
          ];
        });
      }

      if (printAfter) {
        router.push(`/quotations/${body.id}/print`);
      } else {
        resetForm();
        setSaving(false);
      }
    } catch {
      setError("Something went wrong");
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[calc(66.6667%-0.6667px)_1fr]">
      <CustomerSection customers={customers} draft={customerDraft} onDraftChange={setCustomerDraft} />

      <Card className="flex flex-col border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:13.5px]">
        <CardHeader>
          <CardTitle className="text-heading">Notes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full flex-1 rounded-lg border border-input bg-transparent p-2.5 text-sm"
          />
        </CardContent>
      </Card>

      <ItemsSection
        products={products}
        lines={lines}
        lineTotals={lineTotals}
        onAddLine={addLine}
        onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
        onQuantityChange={(key, quantity) =>
          setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)))
        }
        onUnitPriceChange={handleUnitPriceChange}
        onDiscountChange={(key, discount) =>
          setLines((prev) => prev.map((l) => (l.key === key ? { ...l, discount } : l)))
        }
        onTotalChange={handleTotalChange}
        onOpenQuickCreate={() => setQuickCreateOpen(true)}
      />

      <Card className="sticky top-4 self-start border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:18.5px]">
        <CardHeader>
          <CardTitle className="text-heading">Totals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-between text-sm text-body">
            <span>Subtotal</span>
            <span>{documentTotals.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-body">
            <span>Total VAT</span>
            <span>{documentTotals.vatTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-heading">
            <span>Grand Total</span>
            <span>{documentTotals.grandTotal.toFixed(2)}</span>
          </div>
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={saving}
            onClick={() => handleSave(true)}
          >
            {saving ? "Saving…" : "Save & Print"}
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={saving} onClick={() => handleSave(false)}>
            Save
          </Button>
        </CardContent>
      </Card>

      <ProductFormDialog
        open={quickCreateOpen}
        product={null}
        onOpenChange={setQuickCreateOpen}
        onSaved={handleQuickCreateSaved}
      />
    </div>
  );
}
