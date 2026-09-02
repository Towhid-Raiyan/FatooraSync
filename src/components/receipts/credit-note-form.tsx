"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/language-provider";
import { calculateCreditNoteLine, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import type { CreditableLine } from "@/lib/receipts/creditable-lines";

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

interface CreditNoteFormProps {
  originalDocumentId: string;
  documentNumber: number;
  lines: CreditableLine[];
}

export function CreditNoteForm({ originalDocumentId, documentNumber, lines }: CreditNoteFormProps) {
  const { dict } = useLocale();
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const creditableLines = lines.filter((line) => line.remainingQuantity > 0);

  const selectedLines = useMemo(() => {
    return creditableLines
      .map((line) => {
        const raw = quantities[line.id];
        const quantity = raw === undefined || raw === "" ? 0 : Number(raw);
        return { line, quantity };
      })
      .filter(({ quantity }) => Number.isFinite(quantity) && quantity > 0);
  }, [creditableLines, quantities]);

  const totals = useMemo(() => {
    const computed = selectedLines.map(({ line, quantity }) =>
      calculateCreditNoteLine({
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        originalQuantity: line.quantity,
        originalDiscount: line.discount,
        creditedQuantity: quantity,
      })
    );
    return calculateDocumentTotals(computed);
  }, [selectedLines]);

  function handleQuantityChange(lineId: string, value: string) {
    setQuantities((prev) => ({ ...prev, [lineId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (selectedLines.length === 0) {
      setError(dict.creditNote.addAtLeastOneItem);
      return;
    }
    for (const { line, quantity } of selectedLines) {
      if (quantity > line.remainingQuantity) {
        setError(dict.creditNote.quantityExceedsRemaining);
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch("/api/credit-notes", {
        method: "POST",
        body: JSON.stringify({
          originalDocumentId,
          lines: selectedLines.map(({ line, quantity }) => ({ originalLineId: line.id, quantity })),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      router.push(`/credit-notes/${body.id}/print`);
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  if (creditableLines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <p className="text-sm text-body">{dict.creditNote.noRemainingLines}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="mb-4 text-lg font-bold text-heading">{dict.creditNote.pageTitleWithNumber(documentNumber)}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        {/* Desktop: table. Matches the established hidden md:block / md:hidden
            table-vs-card-list split used by Customers/Products/Inventory. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-muted-fg">
                <th className="py-1.5">{dict.creditNote.headers.product}</th>
                <th className="py-1.5 text-right">{dict.creditNote.headers.originalQty}</th>
                <th className="py-1.5 text-right">{dict.creditNote.headers.alreadyCredited}</th>
                <th className="py-1.5 text-right">{dict.creditNote.headers.remaining}</th>
                <th className="py-1.5 text-right">{dict.creditNote.headers.creditQty}</th>
              </tr>
            </thead>
            <tbody>
              {creditableLines.map((line) => (
                <tr key={line.id} className="border-b border-border-subtle">
                  <td className="py-1.5">{line.productName}</td>
                  <td className="py-1.5 text-right">{line.quantity}</td>
                  <td className="py-1.5 text-right">{line.creditedQuantity}</td>
                  <td className="py-1.5 text-right">{line.remainingQuantity}</td>
                  <td className="py-1.5 text-right">
                    <Input
                      type="number"
                      min={0}
                      max={line.remainingQuantity}
                      step="0.001"
                      value={quantities[line.id] ?? ""}
                      onChange={(e) => handleQuantityChange(line.id, e.target.value)}
                      className="ms-auto w-24 text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: card list, same breakpoint the table above hides at. */}
        <div className="flex flex-col gap-2 md:hidden">
          {creditableLines.map((line) => (
            <div key={line.id} className="rounded-lg border border-border-subtle p-3 text-sm">
              <div className="mb-2 font-medium text-heading">{line.productName}</div>
              <div className="mb-2 grid grid-cols-3 gap-2 text-xs text-muted-fg">
                <span>
                  {dict.creditNote.headers.originalQty}: <b className="text-body">{line.quantity}</b>
                </span>
                <span>
                  {dict.creditNote.headers.alreadyCredited}: <b className="text-body">{line.creditedQuantity}</b>
                </span>
                <span>
                  {dict.creditNote.headers.remaining}: <b className="text-body">{line.remainingQuantity}</b>
                </span>
              </div>
              <Label className={LABEL_CLASS}>{dict.creditNote.headers.creditQty}</Label>
              <Input
                type="number"
                min={0}
                max={line.remainingQuantity}
                step="0.001"
                value={quantities[line.id] ?? ""}
                onChange={(e) => handleQuantityChange(line.id, e.target.value)}
                className="w-full"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border-subtle bg-bg-app px-3 py-2.5 text-xs text-body">
          <div className="flex justify-between">
            <span>
              <Label className={LABEL_CLASS}>{dict.documentForm.totals.subtotal}</Label>
            </span>
            <span>{totals.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>
              <Label className={LABEL_CLASS}>{dict.documentForm.totals.totalVat}</Label>
            </span>
            <span>{totals.vatTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-heading">
            <span>{dict.documentForm.totals.grandTotal}</span>
            <span>{totals.grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? dict.common.savingEllipsis : dict.creditNote.submit}
        </Button>
      </form>
    </div>
  );
}
