"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { UNIT_LABELS } from "@/components/products/product-form-dialog";
import type { SerializedProduct } from "@/components/products/products-client";
import type { LineTotals } from "@/lib/receipts/calculate-totals";

export interface ReceiptLine {
  key: string;
  productId: string;
  sku: string | null;
  productName: string;
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
  onDiscountChange: (key: string, discount: string) => void;
  onOpenQuickCreate: () => void;
}

export function ItemsSection({
  products,
  lines,
  lineTotals,
  onAddLine,
  onRemoveLine,
  onQuantityChange,
  onDiscountChange,
  onOpenQuickCreate,
}: ItemsSectionProps) {
  const [search, setSearch] = useState("");

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

  return (
    <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">Items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Input
            placeholder="Scan barcode or search by SKU / name"
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
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-bg-app"
                >
                  <span className="font-mono text-xs text-muted-fg">{product.sku}</span>{" "}
                  <span className="text-heading">{product.nameEn}</span>{" "}
                  <span className="text-muted-fg">— {product.unitPrice}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  onOpenQuickCreate();
                  setSearch("");
                }}
                className="block w-full border-t border-border-subtle px-3 py-2 text-left text-sm font-medium text-primary hover:bg-bg-app"
              >
                + New Product
              </button>
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead>VAT</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const exceedsStock = Number(line.quantity) > Number(line.stockAtAdd);
                return (
                  <TableRow key={line.key}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{line.sku ?? "—"}</TableCell>
                    <TableCell>
                      {line.productName}
                      {exceedsStock && <div className="text-xs text-amber-600">exceeds stock</div>}
                    </TableCell>
                    <TableCell>{UNIT_LABELS[line.unit] ?? line.unit}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.001"
                        min="0.001"
                        value={line.quantity}
                        onChange={(e) => onQuantityChange(line.key, e.target.value)}
                        className="w-20 text-right"
                      />
                    </TableCell>
                    <TableCell className="text-right">{line.unitPrice}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.discount}
                        onChange={(e) => onDiscountChange(line.key, e.target.value)}
                        className="w-20 text-right"
                      />
                    </TableCell>
                    <TableCell>{line.vatRate === null ? "Default" : `${line.vatRate}%`}</TableCell>
                    <TableCell className="text-right">{lineTotals[index].lineTotal.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => onRemoveLine(line.key)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
