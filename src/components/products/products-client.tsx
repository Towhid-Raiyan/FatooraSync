"use client";

import { useMemo, useState } from "react";
import type { Product } from "@prisma/client";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/language-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { ProductFormDialog, getUnitLabels } from "./product-form-dialog";

export type SerializedProduct = Omit<Product, "unitPrice" | "vatRate" | "quantity" | "lowStockThreshold"> & {
  unitPrice: string;
  vatRate: string | null;
  quantity: string;
  lowStockThreshold: string | null;
};

function isLowStock(product: SerializedProduct): boolean {
  return product.lowStockThreshold !== null && Number(product.quantity) <= Number(product.lowStockThreshold);
}

export function ProductsClient({
  initialProducts,
  canManageCatalog,
}: {
  initialProducts: SerializedProduct[];
  canManageCatalog: boolean;
}) {
  const { dict } = useLocale();
  const { toast } = useToast();
  const unitLabels = getUnitLabels(dict);
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
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
    toast.success(dict.products.savedToast);
  }

  async function toggleActive(product: SerializedProduct) {
    setActionError(null);
    setTogglingId(product.id);
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !product.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success(dict.products.statusUpdatedToast);
    } catch {
      setActionError(dict.common.somethingWentWrong);
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder={dict.products.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:w-72"
          />
          <label className="flex items-center gap-2 text-sm text-body">
            <Checkbox checked={showInactive} onCheckedChange={(checked) => setShowInactive(checked === true)} />
            {dict.common.showInactive}
          </label>
        </div>
        {canManageCatalog && (
          <Button variant="primary" onClick={() => setDialogState({ open: true, product: null })}>
            {dict.common.addProduct}
          </Button>
        )}
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-red-600">
          {actionError}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">{dict.products.noProductsYet}</p>
          </div>
        ) : (
          <>
            {/* Eight columns doesn't fit a phone -- below md this becomes a
                stacked card per product instead of a horizontally-scrolling
                table; the real table returns at md (768px) and up. */}
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{dict.products.sku}</TableHead>
                    <TableHead>{dict.products.barcode}</TableHead>
                    <TableHead>{dict.products.name}</TableHead>
                    <TableHead>{dict.products.unit}</TableHead>
                    <TableHead className="text-right">{dict.products.unitPrice}</TableHead>
                    <TableHead>{dict.products.vat}</TableHead>
                    <TableHead className="text-right">{dict.products.quantity}</TableHead>
                    <TableHead className="text-right">{dict.common.actions}</TableHead>
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
                      <TableCell>{unitLabels[product.unit] ?? product.unit}</TableCell>
                      <TableCell className="text-right">{product.unitPrice}</TableCell>
                      <TableCell>
                        {product.vatRate === null ? (
                          <Badge variant="secondary">{dict.products.defaultBadge}</Badge>
                        ) : (
                          <Badge>{product.vatRate}%</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1.5">
                          {product.quantity}
                          {isLowStock(product) && (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                              {dict.inventory.lowStockBadge}
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManageCatalog && (
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, product })}>
                              {dict.common.edit}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={togglingId === product.id}
                              onClick={() => toggleActive(product)}
                            >
                              {togglingId === product.id && <Loader2Icon className="size-3.5 animate-spin" />}
                              {product.isActive ? dict.common.deactivate : dict.common.reactivate}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border-subtle md:hidden">
              {filtered.map((product) => (
                <li key={product.id} className={`p-4 ${!product.isActive ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-heading">{product.nameEn}</div>
                      {product.nameAr && <div className="text-xs text-muted-fg">{product.nameAr}</div>}
                    </div>
                    <div className="shrink-0 text-right font-medium text-heading">{product.unitPrice}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-fg">
                    <span className="font-mono">{product.sku ?? "—"}</span>
                    <span>{unitLabels[product.unit] ?? product.unit}</span>
                    <span className="inline-flex items-center gap-1.5">
                      {dict.products.quantity}: {product.quantity}
                      {isLowStock(product) && (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          {dict.inventory.lowStockBadge}
                        </span>
                      )}
                    </span>
                    {product.vatRate === null ? (
                      <Badge variant="secondary">{dict.products.defaultBadge}</Badge>
                    ) : (
                      <Badge>{product.vatRate}%</Badge>
                    )}
                  </div>
                  {canManageCatalog && (
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, product })}>
                        {dict.common.edit}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={togglingId === product.id}
                        onClick={() => toggleActive(product)}
                      >
                        {togglingId === product.id && <Loader2Icon className="size-3.5 animate-spin" />}
                        {product.isActive ? dict.common.deactivate : dict.common.reactivate}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
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
