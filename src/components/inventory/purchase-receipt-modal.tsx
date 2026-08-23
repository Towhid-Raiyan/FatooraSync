"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { Supplier } from "@prisma/client";
import { Loader2Icon, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/language-provider";
import { round2, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import { ProductFormDialog, getUnitOptions } from "@/components/products/product-form-dialog";
import { SupplierFormDialog } from "@/components/suppliers/supplier-form-dialog";
import type { InventoryProduct, SerializedMovement, SupplierOption } from "./inventory-client";

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

interface PurchaseLine {
  key: string;
  productId: string;
  productName: string;
  productNameAr: string | null;
  sku: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  vatAmount: string;
}

export interface PurchaseReceiptSaved {
  purchaseReceipt: { id: string };
  movements: SerializedMovement[];
}

interface PurchaseReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: InventoryProduct[];
  suppliers: SupplierOption[];
  onSupplierCreated: (supplier: Supplier) => void;
  onProductCreated: (product: InventoryProduct) => void;
  onSaved: (result: PurchaseReceiptSaved) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PurchaseReceiptModal({
  open,
  onOpenChange,
  products,
  suppliers,
  onSupplierCreated,
  onProductCreated,
  onSaved,
}: PurchaseReceiptModalProps) {
  const { dict } = useLocale();
  const unitOptions = getUnitOptions(dict);
  const [supplierId, setSupplierId] = useState("");
  const [supplierReceiptNumber, setSupplierReceiptNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CREDIT">("CASH");
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  function resetForm() {
    setSupplierId(suppliers[0]?.id ?? "");
    setSupplierReceiptNumber("");
    setPurchaseDate(todayIso());
    setPaymentMethod("CASH");
    setLines([]);
    setSearch("");
    setError(null);
    setSaving(false);
  }

  // Reset whenever the dialog closes, however that happens -- the X button
  // and Escape/outside-click go through Radix's own onOpenChange, but a
  // successful save closes the dialog from the parent (InventoryClient sets
  // `open` to false directly after onSaved()), bypassing that handler
  // entirely. Watching the `open` prop itself is the one path that catches
  // every case, so the form is always empty the next time it's opened.
  useEffect(() => {
    if (!open) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return products.filter(
      (p) =>
        p.nameEn.toLowerCase().includes(query) ||
        (p.nameAr ?? "").toLowerCase().includes(query) ||
        (p.sku ?? "").toLowerCase().includes(query) ||
        (p.barcode ?? "").toLowerCase().includes(query)
    );
  }, [products, search]);

  function addLine(product: InventoryProduct) {
    setLines((prev) => [
      ...prev,
      {
        key: `${product.id}-${Date.now()}`,
        productId: product.id,
        productName: product.nameEn,
        productNameAr: product.nameAr,
        sku: product.sku,
        unit: product.unit,
        quantity: "1",
        unitPrice: "",
        vatAmount: "",
      },
    ]);
    setSearch("");
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const query = search.trim().toLowerCase();
    if (!query) return;
    const exactBarcode = products.find((p) => (p.barcode ?? "").toLowerCase() === query);
    if (exactBarcode) {
      addLine(exactBarcode);
    } else if (filtered.length === 1) {
      addLine(filtered[0]);
    }
  }

  function updateLine(key: string, patch: Partial<PurchaseLine>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((line) => line.key !== key));
  }

  // Purchase VAT is always entered as a direct SAR amount per line (not a
  // rate) -- decoupled from the product catalog's own sales vatRate, so this
  // computes lineTotal from the entered amount rather than reusing
  // calculateLine()'s rate-based math.
  const lineTotals = useMemo(
    () =>
      lines.map((line) => {
        const lineSubtotal = round2((Number(line.unitPrice) || 0) * (Number(line.quantity) || 0));
        const lineVat = round2(Number(line.vatAmount) || 0);
        return { lineSubtotal, lineVat, lineTotal: round2(lineSubtotal + lineVat) };
      }),
    [lines]
  );

  const { subtotal, vatTotal, grandTotal } = useMemo(() => calculateDocumentTotals(lineTotals), [lineTotals]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supplierId) {
      setError(dict.purchases.supplierRequiredError);
      return;
    }
    if (lines.length === 0) {
      setError(dict.purchases.addAtLeastOneProduct);
      return;
    }
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      const vatAmount = Number(line.vatAmount);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(dict.inventory.invalidQuantity);
        return;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(vatAmount) || vatAmount < 0) {
        setError(dict.common.somethingWentWrong);
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch("/api/purchase-receipts", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          supplierReceiptNumber: supplierReceiptNumber || undefined,
          purchaseDate,
          paymentMethod,
          lines: lines.map((line) => ({
            productId: line.productId,
            unit: line.unit,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            vatAmount: Number(line.vatAmount),
          })),
        }),
      });
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[95vh] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto md:max-w-[calc(100vw-4px)] lg:max-w-[1142px]">
          <DialogHeader>
            <DialogTitle>{dict.purchases.newPurchaseTitle}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <Card size="sm" className="border border-border-subtle">
              <CardHeader>
                <CardTitle className="text-heading">{dict.purchases.supplierSectionTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className={LABEL_CLASS}>{dict.purchases.supplierSectionTitle}</Label>
                    <div className="flex gap-2">
                      <select
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
                      <Button type="button" variant="outline" onClick={() => setSupplierDialogOpen(true)} className="shrink-0">
                        {dict.inventory.newSupplier}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label className={LABEL_CLASS}>{dict.purchases.supplierReceiptNumber}</Label>
                    <Input
                      value={supplierReceiptNumber}
                      onChange={(e) => setSupplierReceiptNumber(e.target.value)}
                      placeholder={dict.purchases.supplierReceiptNumberPlaceholder}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className={LABEL_CLASS}>{dict.purchases.purchaseDate}</Label>
                    <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
                  </div>
                  <div>
                    <Label className={LABEL_CLASS}>{dict.purchases.paymentSectionTitle}</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={paymentMethod === "CASH" ? "primary" : "outline"}
                        className="flex-1"
                        onClick={() => setPaymentMethod("CASH")}
                      >
                        {dict.purchases.paymentCash}
                      </Button>
                      <Button
                        type="button"
                        variant={paymentMethod === "CREDIT" ? "primary" : "outline"}
                        className="flex-1"
                        onClick={() => setPaymentMethod("CREDIT")}
                      >
                        {dict.purchases.paymentCredit}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card size="sm" className="overflow-visible border border-border-subtle">
              <CardHeader>
                <CardTitle className="text-heading">{dict.purchases.addProductsTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="relative flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      placeholder={dict.purchases.addLineSearchPlaceholder}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                    />
                    {search.trim() && (
                      <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
                        {filtered.map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => addLine(product)}
                            className="block w-full px-3 py-2 text-start text-sm hover:bg-bg-app"
                          >
                            <span className="font-mono text-xs text-muted-fg">{product.sku}</span>{" "}
                            <span className="text-heading">{product.nameEn}</span>
                          </button>
                        ))}
                        {filtered.length === 0 && (
                          <div className="px-3 py-2 text-sm text-muted-fg">{dict.documentForm.itemsSection.noMatches}</div>
                        )}
                      </div>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setQuickCreateOpen(true)} className="shrink-0">
                    {dict.common.addProduct}
                  </Button>
                </div>

                {/* Both boxes below are always rendered at a fixed height, whether
                    or not there are any lines yet -- reserving the space up front so
                    adding the first product never changes the modal's overall size. */}
                <>
                    {/* Desktop (lg+): full table. Below lg, this table's 8 columns don't
                        fit any reasonable modal width without horizontal scroll hiding
                        part of the row -- the card list below is the readable layout for
                        phone and tablet instead. Fixed height (not max-height) so the
                        modal's own size stays constant as products are added -- only this
                        box scrolls, sized to keep at least 3 rows visible. */}
                    <div className="hidden h-[215px] overflow-y-auto overflow-x-auto rounded-lg border border-border-subtle lg:block">
                      {lines.length === 0 ? (
                        <p className="flex h-full items-center justify-center text-sm text-muted-fg">
                          {dict.purchases.noLinesYet}
                        </p>
                      ) : (
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-bg-card">
                          <TableRow>
                            <TableHead>{dict.purchases.columnProduct}</TableHead>
                            <TableHead>{dict.purchases.columnUnit}</TableHead>
                            <TableHead className="text-right">{dict.purchases.columnQty}</TableHead>
                            <TableHead className="text-right">{dict.purchases.columnUnitPrice}</TableHead>
                            <TableHead className="text-right">{dict.purchases.columnSubtotal}</TableHead>
                            <TableHead className="text-right">{dict.purchases.columnVat}</TableHead>
                            <TableHead className="text-right">{dict.purchases.columnTotal}</TableHead>
                            <TableHead className="text-right">{dict.purchases.columnActions}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lines.map((line, index) => {
                            const { lineSubtotal, lineTotal } = lineTotals[index];
                            return (
                              <TableRow key={line.key}>
                                <TableCell>
                                  <div className="font-medium text-heading">{line.productName}</div>
                                  {line.productNameAr && (
                                    <div className="text-xs text-emerald-600 dark:text-emerald-400">{line.productNameAr}</div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <select
                                    value={line.unit}
                                    onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs"
                                  >
                                    {unitOptions.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Input
                                    type="number"
                                    step="0.001"
                                    min="0.001"
                                    value={line.quantity}
                                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                                    className="w-16 text-right"
                                  />
                                </TableCell>
                                <TableCell className="text-right">
                                  <Input
                                    type="number"
                                    step="0.001"
                                    min="0"
                                    value={line.unitPrice}
                                    onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                                    className="w-24 text-right"
                                  />
                                </TableCell>
                                <TableCell className="text-right text-muted-fg">{lineSubtotal.toFixed(2)}</TableCell>
                                <TableCell className="text-right">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={line.vatAmount}
                                    onChange={(e) => updateLine(line.key, { vatAmount: e.target.value })}
                                    className="w-20 text-right"
                                  />
                                </TableCell>
                                <TableCell className="text-right font-semibold text-heading">{lineTotal.toFixed(2)}</TableCell>
                                <TableCell className="text-right">
                                  <button
                                    type="button"
                                    aria-label={dict.a11y.removeItem}
                                    onClick={() => removeLine(line.key)}
                                    className="rounded-md p-1 text-red-600 hover:bg-red-600/10"
                                  >
                                    <X className="size-4" />
                                  </button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      )}
                    </div>

                    {/* Phone/tablet (below lg): one card per line, every field stacked
                        and fully visible -- no horizontal scrolling to see a row. Fixed
                        height (not max-height) for the same reason as the desktop table
                        above -- the modal's size stays constant as products are added. */}
                    <ul className="flex h-[340px] flex-col gap-2 overflow-y-auto lg:hidden">
                      {lines.length === 0 ? (
                        <li className="flex h-full items-center justify-center text-sm text-muted-fg">
                          {dict.purchases.noLinesYet}
                        </li>
                      ) : (
                      lines.map((line, index) => {
                        const { lineSubtotal, lineTotal } = lineTotals[index];
                        return (
                          <li key={line.key} className="rounded-lg border border-border-subtle p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-medium text-heading">{line.productName}</div>
                                {line.productNameAr && (
                                  <div className="text-xs text-emerald-600 dark:text-emerald-400">{line.productNameAr}</div>
                                )}
                              </div>
                              <button
                                type="button"
                                aria-label={dict.a11y.removeItem}
                                onClick={() => removeLine(line.key)}
                                className="shrink-0 rounded-md p-1 text-red-600 hover:bg-red-600/10"
                              >
                                <X className="size-4" />
                              </button>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                              <div>
                                <Label className={LABEL_CLASS}>{dict.purchases.columnUnit}</Label>
                                <select
                                  value={line.unit}
                                  onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs"
                                >
                                  {unitOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <Label className={LABEL_CLASS}>{dict.purchases.columnQty}</Label>
                                <Input
                                  type="number"
                                  step="0.001"
                                  min="0.001"
                                  value={line.quantity}
                                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label className={LABEL_CLASS}>{dict.purchases.columnUnitPrice}</Label>
                                <Input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  value={line.unitPrice}
                                  onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label className={LABEL_CLASS}>{dict.purchases.columnVat}</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={line.vatAmount}
                                  onChange={(e) => updateLine(line.key, { vatAmount: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label className={LABEL_CLASS}>{dict.purchases.columnSubtotal}</Label>
                                <div className="flex h-8 items-center text-sm text-muted-fg">{lineSubtotal.toFixed(2)}</div>
                              </div>
                              <div>
                                <Label className={LABEL_CLASS}>{dict.purchases.columnTotal}</Label>
                                <div className="flex h-8 items-center text-sm font-semibold text-heading">{lineTotal.toFixed(2)}</div>
                              </div>
                            </div>
                          </li>
                        );
                      })
                      )}
                    </ul>
                </>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border-subtle bg-bg-app px-4 py-2 text-sm">
              <div className="flex justify-between text-body">
                <span>{dict.purchases.subtotalLabel}</span>
                <span>{subtotal.toFixed(2)} SAR</span>
              </div>
              <div className="flex justify-between text-body">
                <span>{dict.purchases.totalVatLabel}</span>
                <span>{vatTotal.toFixed(2)} SAR</span>
              </div>
              <div className="flex justify-between text-base font-bold text-heading">
                <span>{dict.purchases.grandTotalLabel}</span>
                <span>{grandTotal.toFixed(2)} SAR</span>
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving && <Loader2Icon className="size-3.5 animate-spin" />}
                {saving ? dict.common.savingEllipsis : dict.purchases.savePurchase}
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

      <ProductFormDialog
        open={quickCreateOpen}
        product={null}
        onOpenChange={setQuickCreateOpen}
        onSaved={(product) => {
          const inventoryProduct: InventoryProduct = {
            id: product.id,
            nameEn: product.nameEn,
            nameAr: product.nameAr,
            sku: product.sku,
            barcode: product.barcode,
            unit: product.unit,
            unitPrice: product.unitPrice,
            vatRate: product.vatRate,
            quantity: product.quantity,
            lowStockThreshold: product.lowStockThreshold,
          };
          onProductCreated(inventoryProduct);
          addLine(inventoryProduct);
          setQuickCreateOpen(false);
        }}
      />
    </>
  );
}
