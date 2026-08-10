"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import type { SerializedProduct } from "@/components/products/products-client";
import { calculateLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import { CustomerSection, type NewCustomerDraft } from "./customer-section";
import { ItemsSection, type ReceiptLine } from "./items-section";

const EMPTY_NEW_CUSTOMER: NewCustomerDraft = { name: "", vatId: "", crNumber: "", phone: "", address: "" };

interface ReceiptFormProps {
  initialCustomers: Customer[];
  initialProducts: SerializedProduct[];
  defaultVatRate: string;
}

export function ReceiptForm({ initialCustomers, initialProducts, defaultVatRate }: ReceiptFormProps) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [products, setProducts] = useState(initialProducts);

  const walkIn = customers.find((c) => c.isWalkIn) ?? null;
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(walkIn?.id ?? null);
  const [addingNewCustomer, setAddingNewCustomer] = useState(false);
  const [newCustomerDraft, setNewCustomerDraft] = useState<NewCustomerDraft>(EMPTY_NEW_CUSTOMER);

  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [notes, setNotes] = useState("");
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolves each line's VAT the same way the server does (Task 2): the product's
  // own override if it has one, otherwise the tenant's real default -- never a
  // hardcoded 0%, which would silently understate every default-VAT line's total
  // on screen relative to what actually gets saved.
  const lineTotals = useMemo(
    () =>
      lines.map((line) =>
        calculateLine({
          unitPrice: Number(line.unitPrice),
          quantity: Number(line.quantity),
          vatRate: Number(line.vatRate ?? defaultVatRate),
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
        quantity: "1",
        unitPrice: product.unitPrice,
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

  function resetForm() {
    setSelectedCustomerId(walkIn?.id ?? null);
    setAddingNewCustomer(false);
    setNewCustomerDraft(EMPTY_NEW_CUSTOMER);
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
      customerId: addingNewCustomer ? undefined : selectedCustomerId,
      newCustomer: addingNewCustomer ? newCustomerDraft : undefined,
      lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      notes,
    };

    try {
      const response = await fetch("/api/receipts", { method: "POST", body: JSON.stringify(payload) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Something went wrong");
        setSaving(false);
        return;
      }

      if (addingNewCustomer) {
        setCustomers((prev) => [
          ...prev,
          {
            id: body.customerId,
            tenantId: "", // not used by any UI in this list -- fine to leave blank client-side
            name: newCustomerDraft.name,
            vatId: newCustomerDraft.vatId || null,
            crNumber: newCustomerDraft.crNumber || null,
            phone: newCustomerDraft.phone || null,
            address: newCustomerDraft.address || null,
            isWalkIn: false,
            isActive: true,
            createdAt: new Date(),
          },
        ]);
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
      setError("Something went wrong");
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2 flex flex-col gap-4">
        <CustomerSection
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          addingNew={addingNewCustomer}
          newCustomerDraft={newCustomerDraft}
          onSelectCustomer={setSelectedCustomerId}
          onStartAddNew={() => {
            setAddingNewCustomer(true);
            setSelectedCustomerId(null);
          }}
          onCancelAddNew={() => {
            setAddingNewCustomer(false);
            setSelectedCustomerId(walkIn?.id ?? null);
          }}
          onNewCustomerDraftChange={setNewCustomerDraft}
        />

        <ItemsSection
          products={products}
          lines={lines}
          lineTotals={lineTotals}
          onAddLine={addLine}
          onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
          onQuantityChange={(key, quantity) =>
            setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)))
          }
          onOpenQuickCreate={() => setQuickCreateOpen(true)}
        />

        <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
          <CardHeader>
            <CardTitle className="text-heading">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-input bg-transparent p-2.5 text-sm"
              rows={3}
            />
          </CardContent>
        </Card>
      </div>

      <div className="col-span-1">
        <Card className="sticky top-4 border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
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
      </div>

      <ProductFormDialog
        open={quickCreateOpen}
        product={null}
        onOpenChange={setQuickCreateOpen}
        onSaved={handleQuickCreateSaved}
      />
    </div>
  );
}
