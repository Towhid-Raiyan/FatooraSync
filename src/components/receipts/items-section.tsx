"use client";

import { useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getUnitLabels } from "@/components/products/product-form-dialog";
import type { SerializedProduct } from "@/components/products/products-client";
import type { LineTotals } from "@/lib/receipts/calculate-totals";
import { useLocale } from "@/lib/i18n/language-provider";

export interface ReceiptLine {
  key: string;
  productId: string;
  sku: string | null;
  productName: string;
  productNameAr: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vatRate: string | null;
  stockAtAdd: string;
}

interface ItemsSectionProps {
  products: SerializedProduct[];
  lines: ReceiptLine[];
  lineTotals: LineTotals[]; // same length/order as `lines` -- the resolved-VAT truth, computed once in ReceiptForm
  onAddLine: (product: SerializedProduct) => void;
  onRemoveLine: (key: string) => void;
  onQuantityChange: (key: string, quantity: string) => void;
  onUnitPriceChange: (key: string, unitPrice: string) => void;
  onDiscountChange: (key: string, discount: string) => void;
  onTotalChange: (key: string, total: string) => void;
  onOpenQuickCreate: () => void;
}

export function ItemsSection({
  products,
  lines,
  lineTotals,
  onAddLine,
  onRemoveLine,
  onQuantityChange,
  onUnitPriceChange,
  onDiscountChange,
  onTotalChange,
  onOpenQuickCreate,
}: ItemsSectionProps) {
  const { dict } = useLocale();
  const unitLabels = getUnitLabels(dict);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Editing Total is a reverse calculation (it back-solves Unit Price), so the
  // displayed total is normally the computed `lineTotal` -- except while a cell is
  // actively focused, when it shows exactly what was typed so far. Committing
  // (blur) is what triggers the actual recalculation; recomputing on every
  // keystroke would fight the cursor as `lineTotal` snaps back mid-edit.
  const [totalDrafts, setTotalDrafts] = useState<Record<string, string>>({});

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

  function handleSelect(product: SerializedProduct) {
    onAddLine(product);
    setSearch("");
  }

  // Only commits if the draft actually differs from what the field was seeded
  // with on focus. Without this check, simply tabbing through a Total cell with
  // no edit still round-trips through the back-calculation -- and because
  // `deriveUnitPriceFromTotal` inverts continuous-math while `calculateLine`
  // rounds at several points, a no-op focus/blur could silently nudge the unit
  // price by a cent on fractional quantities.
  function commitTotalDraft(key: string, seededValue: string) {
    const draft = totalDrafts[key];
    if (draft !== undefined && draft !== seededValue) {
      onTotalChange(key, draft);
    }
    setTotalDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  return (
    <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:18.5px]">
      <CardHeader>
        <CardTitle className="text-heading">{dict.documentForm.itemsSection.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              ref={searchInputRef}
              placeholder={dict.documentForm.itemsSection.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {search.trim() && (
              <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
                {filtered.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handleSelect(product)}
                    className="block w-full px-3 py-2 text-start text-sm hover:bg-bg-app"
                  >
                    <span className="font-mono text-xs text-muted-fg">{product.sku}</span>{" "}
                    <span className="text-heading">{product.nameEn}</span>{" "}
                    <span className="text-muted-fg">— {product.unitPrice}</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-fg">{dict.documentForm.itemsSection.noMatches}</div>
                )}
              </div>
            )}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onOpenQuickCreate} className="shrink-0">
            {dict.common.addProduct}
          </Button>
        </div>

        {lines.length > 0 && (
          // `overflow-y-auto` bounds the card's height (the "increase Items height"
          // request just below); horizontal scroll is the Table component's own
          // built-in behavior (its internal wrapper is `overflow-x-auto`) for when
          // the row's columns don't all fit. Actions used to be `sticky right-0` to
          // stay visible during that scroll, but `position: sticky` overlaps
          // whatever's underneath it unconditionally -- even when the table isn't
          // actually scrolled, it still floated on top of the tail end of the Total
          // column, hiding it. The column widths below (plus the wider Items/
          // Customer split in receipt-form.tsx/quotation-form.tsx) are sized so the
          // table fits without needing horizontal scroll for realistic data, which
          // makes the sticky behavior both unnecessary and actively harmful -- a
          // plain in-flow column has no such overlap risk.
          <div className="max-h-[425px] overflow-y-auto rounded-lg border border-border-subtle">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dict.documentForm.itemsSection.headers.number}</TableHead>
                  <TableHead>{dict.documentForm.itemsSection.headers.sku}</TableHead>
                  <TableHead>{dict.documentForm.itemsSection.headers.product}</TableHead>
                  <TableHead>{dict.documentForm.itemsSection.headers.unit}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.qty}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.price}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.disc}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.vat}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.total}</TableHead>
                  <TableHead className="bg-bg-card text-right">
                    {dict.documentForm.itemsSection.headers.actions}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const exceedsStock = Number(line.quantity) > Number(line.stockAtAdd);
                  const rawSubtotal = Number(line.unitPrice) * Number(line.quantity);
                  const discountExceedsSubtotal = Number(line.discount) > rawSubtotal;
                  const { lineVat, lineTotal } = lineTotals[index];
                  return (
                    <TableRow key={line.key} className="group">
                      <TableCell className="text-muted-fg">{index + 1}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {line.sku ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-heading">{line.productName}</div>
                        {line.productNameAr && (
                          <div className="text-xs text-emerald-600 dark:text-emerald-400">{line.productNameAr}</div>
                        )}
                        {exceedsStock && (
                          <div className="text-xs text-amber-600">{dict.documentForm.itemsSection.exceedsStock}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-fg">{unitLabels[line.unit] ?? line.unit}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={line.quantity}
                          onChange={(e) => onQuantityChange(line.key, e.target.value)}
                          className="w-16 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.unitPrice}
                          onChange={(e) => onUnitPriceChange(line.key, e.target.value)}
                          className="w-24 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.discount}
                          onChange={(e) => onDiscountChange(line.key, e.target.value)}
                          className="w-16 text-right"
                        />
                        {discountExceedsSubtotal && (
                          <div className="text-xs text-red-600">{dict.documentForm.itemsSection.exceedsSubtotal}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-fg">{lineVat.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={totalDrafts[line.key] ?? lineTotal.toFixed(2)}
                          onFocus={() =>
                            setTotalDrafts((prev) => ({ ...prev, [line.key]: lineTotal.toFixed(2) }))
                          }
                          onChange={(e) =>
                            setTotalDrafts((prev) => ({ ...prev, [line.key]: e.target.value }))
                          }
                          onBlur={() => commitTotalDraft(line.key, lineTotal.toFixed(2))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          className="w-24 text-right font-semibold text-heading"
                        />
                      </TableCell>
                      <TableCell className="text-right group-hover:bg-muted/50">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label="Confirm line, focus search"
                            onClick={() => searchInputRef.current?.focus()}
                            className="rounded-md p-1 text-emerald-600 hover:bg-emerald-600/10"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Remove item"
                            onClick={() => onRemoveLine(line.key)}
                            className="rounded-md p-1 text-red-600 hover:bg-red-600/10"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
