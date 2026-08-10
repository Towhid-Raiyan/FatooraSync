"use client";

import { useMemo, useState } from "react";
import type { Product } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ProductFormDialog } from "./product-form-dialog";

export type SerializedProduct = Omit<Product, "unitPrice" | "vatRate" | "quantity"> & {
  unitPrice: string;
  vatRate: string | null;
  quantity: string;
};

export function ProductsClient({ initialProducts }: { initialProducts: SerializedProduct[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{ open: boolean; product: SerializedProduct | null }>({
    open: false,
    product: null,
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products
      .filter((p) => {
        if (!showInactive && !p.isActive) return false;
        if (!query) return true;
        return (
          p.nameEn.toLowerCase().includes(query) ||
          (p.nameAr ?? "").toLowerCase().includes(query) ||
          (p.sku ?? "").toLowerCase().includes(query) ||
          (p.barcode ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  }, [products, search, showInactive]);

  function handleSaved(product: SerializedProduct) {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      return exists ? prev.map((p) => (p.id === product.id ? product : p)) : [...prev, product];
    });
    setDialogState({ open: false, product: null });
  }

  async function toggleActive(product: SerializedProduct) {
    setActionError(null);
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !product.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? "Something went wrong");
        return;
      }
      const updated = await response.json();
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      setActionError("Something went wrong");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search by name, SKU, or barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
          <label className="flex items-center gap-2 text-sm text-body">
            <Checkbox checked={showInactive} onCheckedChange={(checked) => setShowInactive(checked === true)} />
            Show inactive
          </label>
        </div>
        <Button variant="primary" onClick={() => setDialogState({ open: true, product: null })}>
          + Add Product
        </Button>
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-red-600">
          {actionError}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">No products yet — add your first one</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead>VAT</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => (
                <TableRow key={product.id} className={!product.isActive ? "opacity-50" : undefined}>
                  <TableCell className="font-mono text-xs">{product.sku ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{product.barcode ?? "—"}</TableCell>
                  <TableCell className="font-medium text-heading">
                    {product.nameEn}
                    {product.nameAr && <div className="text-xs text-muted-fg">{product.nameAr}</div>}
                  </TableCell>
                  <TableCell>{product.unit}</TableCell>
                  <TableCell className="text-right">{product.unitPrice}</TableCell>
                  <TableCell>
                    {product.vatRate === null ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : (
                      <Badge>{product.vatRate}%</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{product.quantity}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, product })}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleActive(product)}>
                        {product.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ProductFormDialog
        open={dialogState.open}
        product={dialogState.product}
        onOpenChange={(open) => setDialogState((s) => ({ ...s, open }))}
        onSaved={handleSaved}
      />
    </div>
  );
}
