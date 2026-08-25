"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@prisma/client";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { PrintModal } from "@/components/documents/print-modal";
import type { SerializedProduct } from "@/components/products/products-client";
import { round3, calculateLine, calculateDocumentTotals, deriveUnitPriceFromTotal } from "@/lib/receipts/calculate-totals";
import { formatQuotationNumber } from "@/lib/quotations/quotation-number";
import { useLocale } from "@/lib/i18n/language-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { CustomerSection, type CustomerDraft } from "./customer-section";
import { ItemsSection, type ReceiptLine } from "./items-section";

interface QuotationPrefillLine {
  productId: string;
  sku: string | null;
  productName: string;
  productNameAr: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vatRate: string;
  stockAtAdd: string;
}

interface QuotationPrefill {
  number: number;
  customer: { name: string; vatId: string; crNumber: string; phone: string; address: string };
  lines: QuotationPrefillLine[];
}

const EMPTY_CUSTOMER_DRAFT: CustomerDraft = { name: "", vatId: "", crNumber: "", phone: "", address: "" };

interface ReceiptFormProps {
  initialCustomers: Customer[];
  initialProducts: SerializedProduct[];
  defaultVatRate: string;
}

export function ReceiptForm({ initialCustomers, initialProducts, defaultVatRate }: ReceiptFormProps) {
  const { dict } = useLocale();
  const { toast } = useToast();
  const [customers, setCustomers] = useState(initialCustomers);
  const [products, setProducts] = useState(initialProducts);

  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT);

  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [notes, setNotes] = useState("");
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printModalId, setPrintModalId] = useState<string | null>(null);

  // Resolves each line's VAT the same way the server does (Task 2): the product's
  // own override if it has one, otherwise the tenant's real default -- never a
  // hardcoded 0%, which would silently understate every default-VAT line's total
  // on screen relative to what actually gets saved. `unitPrice` is rounded to 3dp
  // here too, matching the server's own `round3` on the same field (route.ts) --
  // a manually-typed sub-thousandth price would otherwise feed an unrounded value
  // into `calculateLine` on screen but a rounded one on save, producing two
  // different totals for the same typed input.
  const lineTotals = useMemo(
    () =>
      lines.map((line) =>
        calculateLine({
          unitPrice: round3(Number(line.unitPrice)),
          quantity: Number(line.quantity),
          vatRate: Number(line.vatRate ?? defaultVatRate),
          discount: Number(line.discount),
        })
      ),
    [lines, defaultVatRate]
  );
  const documentTotals = useMemo(() => calculateDocumentTotals(lineTotals), [lineTotals]);

  // Selecting the same product twice (e.g. scanning its barcode again) bumps
  // the existing row's quantity instead of adding a duplicate row -- a second
  // line for the same product isn't a meaningful distinction to a cashier, and
  // duplicate rows make the receipt harder to scan at a glance.
  function addLine(product: SerializedProduct) {
    setLines((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      if (existing) {
        return prev.map((line) =>
          line.key === existing.key ? { ...line, quantity: String(Number(line.quantity) + 1) } : line
        );
      }
      return [
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
      ];
    });
  }

  // "Load from quotation": merges an approved quotation's lines/customer into
  // whatever's already on the form, same additive spirit as scanning a
  // barcode twice -- a matching product bumps quantity instead of duplicating
  // the row, and customer fields only fill in whatever the cashier hasn't
  // already typed by hand. Price/discount/VAT come from the quotation's own
  // saved line values (what was actually quoted), not the product's current
  // catalog price.
  async function handleSelectQuotation(quotationId: string) {
    try {
      const response = await fetch(`/api/quotations/${quotationId}/for-receipt`);
      const body = await response.json();
      if (!response.ok) {
        toast.error(body.error ?? dict.documentForm.itemsSection.quotationLoadError);
        return;
      }
      const prefill = body as QuotationPrefill;

      setCustomerDraft((prev) => ({
        name: prev.name || prefill.customer.name,
        vatId: prev.vatId || prefill.customer.vatId,
        crNumber: prev.crNumber || prefill.customer.crNumber,
        phone: prev.phone || prefill.customer.phone,
        address: prev.address || prefill.customer.address,
      }));

      setLines((prev) => {
        const next = [...prev];
        for (const line of prefill.lines) {
          const existingIndex = next.findIndex((l) => l.productId === line.productId);
          if (existingIndex !== -1) {
            next[existingIndex] = {
              ...next[existingIndex],
              quantity: String(Number(next[existingIndex].quantity) + Number(line.quantity)),
            };
          } else {
            next.push({
              key: `${line.productId}-${next.length}-${Date.now()}`,
              productId: line.productId,
              sku: line.sku,
              productName: line.productName,
              productNameAr: line.productNameAr,
              unit: line.unit,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount,
              vatRate: line.vatRate,
              stockAtAdd: line.stockAtAdd,
            });
          }
        }
        return next;
      });

      toast.success(dict.documentForm.itemsSection.quotationLoadedToast(formatQuotationNumber(prefill.number)));
    } catch {
      toast.error(dict.documentForm.itemsSection.quotationLoadError);
    }
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
        return { ...line, unitPrice: unitPrice.toFixed(3) };
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
        setPrintModalId(body.id);
        setSaving(false);
      } else {
        toast.success(dict.documentForm.totals.savedToast);
        resetForm();
        setSaving(false);
      }
    } catch {
      setError(dict.common.somethingWentWrong);
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Below xl (1280px -- phones, and iPad Pro in portrait) this is a plain
          stacked column in DOM/reading order: Customer, Items, Notes, Totals,
          and the page scrolls normally like any form. xl:grid-rows-[auto_1fr]
          switches to the desktop layout, where explicit col-start/row-start
          placement re-arranges the same four cards into Customer+Notes on
          row 1 (sharing one height automatically via CSS Grid's item stretch)
          and Items+Totals filling the rest, with only the item rows
          scrolling (see items-section.tsx). */}
      {/* content-start: below xl the 4 cards are auto-height implicit rows, but
          the grid itself is stretched (flex-1) to fill the page -- without this,
          Grid's default align-content:stretch was distributing that leftover
          height back into each row, inflating the Items card (and everything
          else) taller than its actual content and starving the item rows of
          usable height inside it. Harmless at xl+: the explicit 1fr row there
          already consumes all leftover space on its own. */}
      <div className="grid flex-1 content-start grid-cols-1 gap-4 min-h-0 xl:grid-cols-[4fr_1fr] xl:grid-rows-[auto_1fr]">
        <CustomerSection
          customers={customers}
          draft={customerDraft}
          onDraftChange={setCustomerDraft}
          className="xl:col-start-1 xl:row-start-1"
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
          onUnitPriceChange={handleUnitPriceChange}
          onDiscountChange={(key, discount) =>
            setLines((prev) => prev.map((l) => (l.key === key ? { ...l, discount } : l)))
          }
          onTotalChange={handleTotalChange}
          onOpenQuickCreate={() => setQuickCreateOpen(true)}
          onSelectQuotation={handleSelectQuotation}
          className="xl:col-start-1 xl:row-start-2 xl:min-h-0"
        />

        {/* overflow-visible: Card's default overflow-hidden makes CSS Grid treat this
            item's automatic minimum size (and its max-content contribution) as ~0 when
            sizing its auto row track below xl -- the row was collapsing to ~29px (just
            the Card's own padding) regardless of how much the header+textarea actually
            needed, clipping the whole Notes card to invisible. See the matching note in
            items-section.tsx and customer-section.tsx for the same root cause. */}
        <Card className="flex flex-col overflow-visible border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:13.5px] xl:col-start-2 xl:row-start-1">
          <CardHeader>
            <CardTitle className="text-heading">{dict.documentForm.notesTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full flex-1 rounded-lg border border-input bg-transparent p-2.5 text-sm"
            />
          </CardContent>
        </Card>

        <div className="xl:col-start-2 xl:row-start-2 xl:min-h-0">
          <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:18.5px]">
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
                {saving && <Loader2Icon className="size-3.5 animate-spin" />}
                {saving ? dict.common.savingEllipsis : dict.documentForm.totals.savePrint}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={saving}
                onClick={() => handleSave(false)}
              >
                {saving && <Loader2Icon className="size-3.5 animate-spin" />}
                {saving ? dict.common.savingEllipsis : dict.common.save}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <ProductFormDialog
        open={quickCreateOpen}
        product={null}
        onOpenChange={setQuickCreateOpen}
        onSaved={handleQuickCreateSaved}
      />

      <PrintModal
        kind="receipt"
        documentId={printModalId}
        onOpenChange={(open) => {
          if (!open) {
            setPrintModalId(null);
            resetForm();
          }
        }}
      />
    </div>
  );
}
