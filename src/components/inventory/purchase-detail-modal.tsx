"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getUnitLabels } from "@/components/products/product-form-dialog";
import { useLocale } from "@/lib/i18n/language-provider";

interface PurchaseDetail {
  id: string;
  number: number;
  supplierReceiptNumber: string | null;
  purchaseDate: string;
  paymentMethod: "CASH" | "CREDIT";
  subtotal: string;
  vatTotal: string;
  grandTotal: string;
  supplier: { name: string; vatId: string | null; crNumber: string | null; phone: string | null };
  lines: {
    id: string;
    productName: string;
    unit: string;
    quantity: string;
    unitPrice: string;
    vatRate: string;
    lineSubtotal: string;
    lineVat: string;
    lineTotal: string;
  }[];
}

export function PurchaseDetailModal({
  purchaseReceiptId,
  onOpenChange,
}: {
  purchaseReceiptId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { dict } = useLocale();
  const unitLabels = getUnitLabels(dict);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!purchaseReceiptId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/purchase-receipts/${purchaseReceiptId}`)
      .then((response) => {
        if (!response.ok) throw new Error("failed");
        return response.json();
      })
      .then((body) => {
        if (!cancelled) setDetail(body);
      })
      .catch(() => {
        if (!cancelled) setError(dict.purchases.loadError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [purchaseReceiptId, dict.purchases.loadError]);

  const open = purchaseReceiptId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{detail ? dict.purchases.detailTitle(detail.number) : ""}</DialogTitle>
        </DialogHeader>

        {loading && <div className="py-10 text-center text-sm text-muted-fg">{dict.common.loading}</div>}
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        {detail && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-lg border border-dashed border-border-subtle bg-bg-app p-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-fg">{dict.purchases.columnSupplier}: </span>
                <span className="font-medium text-heading">{detail.supplier.name}</span>
              </div>
              <div>
                <span className="text-muted-fg">{dict.purchases.columnDate}: </span>
                <span className="text-body">{detail.purchaseDate.slice(0, 10)}</span>
              </div>
              {detail.supplier.vatId && (
                <div>
                  <span className="text-muted-fg">{dict.purchases.detailVatId}: </span>
                  <span className="font-mono text-xs text-body">{detail.supplier.vatId}</span>
                </div>
              )}
              {detail.supplier.crNumber && (
                <div>
                  <span className="text-muted-fg">{dict.purchases.detailCrNumber}: </span>
                  <span className="font-mono text-xs text-body">{detail.supplier.crNumber}</span>
                </div>
              )}
              {detail.supplier.phone && (
                <div>
                  <span className="text-muted-fg">{dict.purchases.detailPhone}: </span>
                  <span className="text-body">{detail.supplier.phone}</span>
                </div>
              )}
              {detail.supplierReceiptNumber && (
                <div>
                  <span className="text-muted-fg">{dict.purchases.detailSupplierReceiptNumber}: </span>
                  <span className="text-body">{detail.supplierReceiptNumber}</span>
                </div>
              )}
              <div>
                <span className="text-muted-fg">{dict.purchases.columnPayment}: </span>
                <span className="text-body">
                  {detail.paymentMethod === "CASH" ? dict.purchases.paymentCash : dict.purchases.paymentCredit}
                </span>
              </div>
            </div>

            <div className="hidden overflow-x-auto rounded-lg border border-border-subtle lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{dict.purchases.columnProduct}</TableHead>
                    <TableHead>{dict.purchases.columnUnit}</TableHead>
                    <TableHead className="text-right">{dict.purchases.columnQty}</TableHead>
                    <TableHead className="text-right">{dict.purchases.columnUnitPrice}</TableHead>
                    <TableHead className="text-right">{dict.purchases.columnSubtotal}</TableHead>
                    <TableHead className="text-right">{dict.purchases.columnVat}</TableHead>
                    <TableHead className="text-right">{dict.purchases.columnTotal}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium text-heading">{line.productName}</TableCell>
                      <TableCell className="text-muted-fg">{unitLabels[line.unit] ?? line.unit}</TableCell>
                      <TableCell className="text-right">{line.quantity}</TableCell>
                      <TableCell className="text-right">{Number(line.unitPrice).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-muted-fg">{Number(line.lineSubtotal).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-muted-fg">{Number(line.lineVat).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-semibold text-heading">
                        {Number(line.lineTotal).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="flex flex-col gap-2 lg:hidden">
              {detail.lines.map((line) => (
                <li key={line.id} className="rounded-lg border border-border-subtle p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-heading">{line.productName}</span>
                    <span className="shrink-0 text-xs text-muted-fg">{unitLabels[line.unit] ?? line.unit}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                    <div>
                      <span className="text-muted-fg">{dict.purchases.columnQty}: </span>
                      <span className="text-body">{line.quantity}</span>
                    </div>
                    <div>
                      <span className="text-muted-fg">{dict.purchases.columnUnitPrice}: </span>
                      <span className="text-body">{Number(line.unitPrice).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-fg">{dict.purchases.columnSubtotal}: </span>
                      <span className="text-body">{Number(line.lineSubtotal).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-fg">{dict.purchases.columnVat}: </span>
                      <span className="text-body">{Number(line.lineVat).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-fg">{dict.purchases.columnTotal}: </span>
                      <span className="font-semibold text-heading">{Number(line.lineTotal).toFixed(2)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border-subtle bg-bg-app px-4 py-3 text-sm">
              <div className="flex justify-between text-body">
                <span>{dict.purchases.subtotalLabel}</span>
                <span>{Number(detail.subtotal).toFixed(2)} SAR</span>
              </div>
              <div className="flex justify-between text-body">
                <span>{dict.purchases.totalVatLabel}</span>
                <span>{Number(detail.vatTotal).toFixed(2)} SAR</span>
              </div>
              <div className="flex justify-between text-base font-bold text-heading">
                <span>{dict.purchases.grandTotalLabel}</span>
                <span>{Number(detail.grandTotal).toFixed(2)} SAR</span>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
