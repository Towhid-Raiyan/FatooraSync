"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import type { SerializedProduct } from "@/components/products/products-client";
import { round2, calculateLine, calculateDocumentTotals, deriveUnitPriceFromTotal } from "@/lib/receipts/calculate-totals";
import { useLocale } from "@/lib/i18n/language-provider";
import { CustomerSection, type CustomerDraft } from "./customer-section";
import { ItemsSection, type ReceiptLine } from "./items-section";

const EMPTY_CUSTOMER_DRAFT: CustomerDraft = { name: "", vatId: "", crNumber: "", phone: "", address: "" };

interface ReceiptFormProps {
  initialCustomers: Customer[];
  initialProducts: SerializedProduct[];
  defaultVatRate: string;
}

export function ReceiptForm({ initialCustomers, initialProducts, defaultVatRate }: ReceiptFormProps) {
  const router = useRouter();
  const { dict } = useLocale();
  const [customers, setCustomers] = useState(initialCustomers);
  const [products, setProducts] = useState(initialProducts);

  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT);

  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [notes, setNotes] = useState("");
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolves each line's VAT the same way the server does (Task 2): the product's
  // own override if it has one, otherwise the tenant's real default -- never a
  // hardcoded 0%, which would silently understate every default-VAT line's total
  // on screen relative to what actually gets saved. `unitPrice` is rounded to 2dp
  // here too, matching the server's own `round2` on the same field (route.ts) --
  // a manually-typed sub-cent price (e.g. "2.345") would otherwise feed an
  // unrounded value into `calculateLine` on screen but a rounded one on save,
  // producing two different totals for the same typed input.
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

  // The cashier can override a line's Unit Price directly -- a manual price at the
  // point of sale (see the trust-boundary note in route.ts). This is a plain
  // forward-direction edit, same as quantity/discount.
  function handleUnitPriceChange(key: string, unitPrice: string) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, unitPrice } : line)));
  }

  // Editing Total is the reverse direction: back-solve the Unit Price that would
  // produce the typed total, holding quantity/discount/VAT fixed, using the same
  // pure function the totals math itself is built on. A genuinely unparsable or
  // negative total is ignored -- the line keeps its last valid price rather than
  // being corrupted by a stray edit. A cleared field parses as `0`, same as
  // Unit Price, and is honored as an explicit zero rather than being ignored --
  // it's indistinguishable from deliberately typing "0".
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
      setError(dict.documentForm.totals.addAtLeastOneItem);
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
      const response = await fetch("/api/receipts", { method: "POST", body: JSON.stringify(payload) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
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
              tenantId: "", // not used by any UI in this list -- fine to leave blank client-side
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
        // Deliberately leave `saving` true through the navigation so the buttons stay
        // disabled until this component unmounts -- clearing it in a `finally` here
        // would re-enable Save & Print for the several seconds router.push takes to
        // actually navigate, letting a second click mint a second immutable receipt.
        router.push(`/receipts/${body.id}/print`);
      } else {
        resetForm();
        setSaving(false);
      }
    } catch {
      setError(dict.common.somethingWentWrong);
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[4fr_1fr]">
      <CustomerSection customers={customers} draft={customerDraft} onDraftChange={setCustomerDraft} />

      <Card className="flex flex-col border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:13.5px]">
        <CardHeader>
          <CardTitle className="text-heading">{dict.documentForm.notesTitle}</CardTitle>
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
          <CardTitle className="text-heading">{dict.documentForm.totals.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-between text-sm text-body">
            <span>{dict.documentForm.totals.subtotal}</span>
            <span>{documentTotals.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-body">
            <span>{dict.documentForm.totals.totalVat}</span>
            <span>{documentTotals.vatTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-heading">
            <span>{dict.documentForm.totals.grandTotal}</span>
            <span>{documentTotals.grandTotal.toFixed(2)}</span>
          </div>
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={saving}
            onClick={() => handleSave(true)}
          >
            {saving ? dict.common.savingEllipsis : dict.documentForm.totals.savePrint}
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={saving} onClick={() => handleSave(false)}>
            {dict.common.save}
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
