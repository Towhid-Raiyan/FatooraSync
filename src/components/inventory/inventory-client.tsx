"use client";

import { useMemo, useState } from "react";
import type { SupplierOption } from "./restock-dialog";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/language-provider";
import { useToast } from "@/lib/toast/toast-provider";
import type { Dictionary } from "@/lib/i18n/dictionaries/dictionary.types";
import { RestockDialog } from "./restock-dialog";
import { AdjustDialog } from "./adjust-dialog";

export type MovementType = "SALE" | "RESTOCK" | "ADJUSTMENT";
export type AdjustmentReason = "DAMAGE" | "LOSS_THEFT" | "RECOUNT" | "OTHER";

export interface InventoryProduct {
  id: string;
  nameEn: string;
  nameAr: string | null;
  sku: string | null;
  quantity: string;
  lowStockThreshold: string | null;
}

export interface SerializedMovement {
  id: string;
  type: MovementType;
  quantityDelta: string;
  quantityAfter: string;
  reason: AdjustmentReason | null;
  note: string | null;
  unitCost: string | null;
  createdAt: string;
  productId: string;
  product: { nameEn: string; nameAr: string | null; sku: string | null };
  supplier: { name: string } | null;
  createdByUser: { email: string };
  document: { type: "SALES_RECEIPT" | "QUOTATION"; number: number } | null;
}

function typePill(type: MovementType, dict: Dictionary) {
  const styles: Record<MovementType, string> = {
    SALE: "bg-primary/10 text-primary",
    RESTOCK: "bg-green-50 text-green-700",
    ADJUSTMENT: "bg-amber-50 text-amber-700",
  };
  const labels: Record<MovementType, string> = {
    SALE: dict.inventory.typeSale,
    RESTOCK: dict.inventory.typeRestock,
    ADJUSTMENT: dict.inventory.typeAdjustment,
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${styles[type]}`}>
      {labels[type]}
    </span>
  );
}

function reasonLabel(reason: AdjustmentReason, dict: Dictionary) {
  const labels: Record<AdjustmentReason, string> = {
    DAMAGE: dict.inventory.reasonDamage,
    LOSS_THEFT: dict.inventory.reasonLossTheft,
    RECOUNT: dict.inventory.reasonRecount,
    OTHER: dict.inventory.reasonOther,
  };
  return labels[reason];
}

function detailCell(movement: SerializedMovement, dict: Dictionary) {
  if (movement.type === "SALE") {
    return movement.document ? dict.inventory.receiptLabel(movement.document.number) : "—";
  }
  if (movement.type === "RESTOCK") {
    return (
      <>
        {movement.supplier?.name ?? "—"}
        {movement.unitCost && <div className="text-muted-fg">{dict.inventory.unitCostLabel(movement.unitCost)}</div>}
      </>
    );
  }
  return (
    <>
      {movement.note ?? "—"}
      {movement.reason && (
        <span className="ms-2 inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-600">
          {reasonLabel(movement.reason, dict)}
        </span>
      )}
    </>
  );
}

function isLowStock(product: InventoryProduct): boolean {
  return product.lowStockThreshold !== null && Number(product.quantity) <= Number(product.lowStockThreshold);
}

export function InventoryClient({
  initialMovements,
  products,
  initialSuppliers,
  canManageCatalog,
}: {
  initialMovements: SerializedMovement[];
  products: InventoryProduct[];
  initialSuppliers: SupplierOption[];
  canManageCatalog: boolean;
}) {
  const { dict, locale } = useLocale();
  const { toast } = useToast();
  const [movements, setMovements] = useState(initialMovements);
  const [productList, setProductList] = useState(products);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [typeFilter, setTypeFilter] = useState<"all" | MovementType>("all");
  const [search, setSearch] = useState("");
  const [restockOpen, setRestockOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const lowStockProducts = useMemo(() => productList.filter(isLowStock), [productList]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return movements.filter((m) => {
      if (typeFilter !== "all" && m.type !== typeFilter) return false;
      if (lowStockOnly && !lowStockProducts.some((p) => p.id === m.productId)) return false;
      if (!query) return true;
      return (
        m.product.nameEn.toLowerCase().includes(query) ||
        (m.product.nameAr ?? "").toLowerCase().includes(query) ||
        (m.product.sku ?? "").toLowerCase().includes(query)
      );
    });
  }, [movements, typeFilter, search, lowStockOnly, lowStockProducts]);

  function applyMovement(movement: SerializedMovement, updatedQuantity: string) {
    setMovements((prev) => [movement, ...prev]);
    setProductList((prev) => prev.map((p) => (p.id === movement.productId ? { ...p, quantity: updatedQuantity } : p)));
  }

  function handleRestockSaved(movement: SerializedMovement, updatedQuantity: string) {
    applyMovement(movement, updatedQuantity);
    setRestockOpen(false);
    toast.success(dict.inventory.restockSavedToast);
  }

  function handleAdjustSaved(movement: SerializedMovement, updatedQuantity: string) {
    applyMovement(movement, updatedQuantity);
    setAdjustOpen(false);
    toast.success(dict.inventory.adjustmentSavedToast);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-heading">{dict.inventory.title}</h1>
          <p className="text-sm text-muted-fg">{dict.inventory.subtitle}</p>
        </div>
        {canManageCatalog && (
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => setAdjustOpen(true)}>
              {dict.inventory.adjustStock}
            </Button>
            <Button variant="primary" onClick={() => setRestockOpen(true)}>
              {dict.inventory.restock}
            </Button>
          </div>
        )}
      </div>

      {lowStockProducts.length > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
          <span className="size-1.5 shrink-0 rounded-full bg-amber-600" />
          <span className="flex-1">{dict.inventory.lowStockBanner(lowStockProducts.length)}</span>
          <button
            type="button"
            onClick={() => setLowStockOnly(true)}
            className="shrink-0 text-xs font-bold underline underline-offset-2"
          >
            {dict.inventory.showThem}
          </button>
        </div>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        <div className="flex flex-col gap-3 border-b border-border-subtle p-4 sm:flex-row sm:items-center">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | MovementType)}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm sm:w-48"
          >
            <option value="all">{dict.inventory.filterAllTypes}</option>
            <option value="SALE">{dict.inventory.filterSales}</option>
            <option value="RESTOCK">{dict.inventory.filterRestocks}</option>
            <option value="ADJUSTMENT">{dict.inventory.filterAdjustments}</option>
          </select>
          <Input
            placeholder={dict.inventory.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:flex-1"
          />
          {lowStockOnly && (
            <button
              type="button"
              onClick={() => setLowStockOnly(false)}
              className="self-start text-xs font-semibold text-primary underline underline-offset-2 sm:self-auto"
            >
              {dict.inventory.clearFilter}
            </button>
          )}
        </div>

        {movements.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">{dict.inventory.noMovementsYet}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">{dict.inventory.noMatches}</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{dict.inventory.columnProduct}</TableHead>
                    <TableHead>{dict.inventory.columnType}</TableHead>
                    <TableHead className="text-right">{dict.inventory.columnChange}</TableHead>
                    <TableHead className="text-right">{dict.inventory.columnStockAfter}</TableHead>
                    <TableHead>{dict.inventory.columnDetail}</TableHead>
                    <TableHead>{dict.inventory.columnByWhen}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium text-heading">
                        {m.product.nameEn}
                        {m.product.sku && <div className="text-xs font-normal text-muted-fg">{m.product.sku}</div>}
                      </TableCell>
                      <TableCell>{typePill(m.type, dict)}</TableCell>
                      <TableCell
                        className={`text-right font-bold ${Number(m.quantityDelta) >= 0 ? "text-primary" : "text-red-600"}`}
                      >
                        {Number(m.quantityDelta) >= 0 ? "+" : ""}
                        {m.quantityDelta}
                      </TableCell>
                      <TableCell className="text-right">{m.quantityAfter}</TableCell>
                      <TableCell className="text-xs text-body">{detailCell(m, dict)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-fg">
                        {m.createdByUser.email}
                        <div>{new Date(m.createdAt).toLocaleString(locale)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border-subtle md:hidden">
              {filtered.map((m) => (
                <li key={m.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-heading">{m.product.nameEn}</div>
                      {m.product.sku && <div className="text-xs text-muted-fg">{m.product.sku}</div>}
                    </div>
                    {typePill(m.type, dict)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className={`font-bold ${Number(m.quantityDelta) >= 0 ? "text-primary" : "text-red-600"}`}>
                      {Number(m.quantityDelta) >= 0 ? "+" : ""}
                      {m.quantityDelta}
                    </span>
                    <span className="text-muted-fg">
                      {dict.inventory.columnStockAfter}: {m.quantityAfter}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-body">{detailCell(m, dict)}</div>
                  <div className="mt-1 text-[11px] text-muted-fg">
                    {m.createdByUser.email} · {new Date(m.createdAt).toLocaleString(locale)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <RestockDialog
        open={restockOpen}
        onOpenChange={setRestockOpen}
        products={productList}
        suppliers={suppliers}
        onSupplierCreated={(supplier) => setSuppliers((prev) => [...prev, supplier])}
        onSaved={handleRestockSaved}
      />
      <AdjustDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        products={productList}
        onSaved={handleAdjustSaved}
      />
    </div>
  );
}
