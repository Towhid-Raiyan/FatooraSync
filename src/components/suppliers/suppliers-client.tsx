"use client";

import { useMemo, useState } from "react";
import type { Supplier } from "@prisma/client";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/language-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { SupplierFormDialog } from "./supplier-form-dialog";

export function SuppliersClient({
  initialSuppliers,
  canManageCatalog,
}: {
  initialSuppliers: Supplier[];
  canManageCatalog: boolean;
}) {
  const { dict } = useLocale();
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogState, setDialogState] = useState<{ open: boolean; supplier: Supplier | null }>({
    open: false,
    supplier: null,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return suppliers
      .filter((s) => {
        if (!showInactive && !s.isActive) return false;
        if (!query) return true;
        return s.name.toLowerCase().includes(query) || (s.phone ?? "").toLowerCase().includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, search, showInactive]);

  function handleSaved(supplier: Supplier) {
    setSuppliers((prev) => {
      const exists = prev.some((s) => s.id === supplier.id);
      return exists ? prev.map((s) => (s.id === supplier.id ? supplier : s)) : [...prev, supplier];
    });
    setDialogState({ open: false, supplier: null });
    toast.success(dict.suppliers.savedToast);
  }

  async function toggleActive(supplier: Supplier) {
    setActionError(null);
    setTogglingId(supplier.id);
    try {
      const response = await fetch(`/api/suppliers/${supplier.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !supplier.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setSuppliers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      toast.success(dict.suppliers.statusUpdatedToast);
    } catch {
      setActionError(dict.common.somethingWentWrong);
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-heading">{dict.suppliers.title}</h1>
        <p className="text-sm text-muted-fg">{dict.suppliers.subtitle}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder={dict.suppliers.searchPlaceholder}
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
          <Button variant="primary" onClick={() => setDialogState({ open: true, supplier: null })}>
            + {dict.suppliers.dialogTitleAdd}
          </Button>
        )}
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-red-600">
          {actionError}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {suppliers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">{dict.suppliers.noSuppliersYet}</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{dict.suppliers.name}</TableHead>
                    <TableHead>{dict.suppliers.phone}</TableHead>
                    <TableHead>{dict.suppliers.address}</TableHead>
                    <TableHead className="text-right">{dict.common.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((supplier) => (
                    <TableRow key={supplier.id} className={!supplier.isActive ? "opacity-50" : undefined}>
                      <TableCell className="font-medium text-heading">{supplier.name}</TableCell>
                      <TableCell>{supplier.phone ?? "—"}</TableCell>
                      <TableCell>{supplier.address ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {canManageCatalog && (
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, supplier })}>
                              {dict.common.edit}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={togglingId === supplier.id}
                              onClick={() => toggleActive(supplier)}
                            >
                              {togglingId === supplier.id && <Loader2Icon className="size-3.5 animate-spin" />}
                              {supplier.isActive ? dict.common.deactivate : dict.common.reactivate}
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
              {filtered.map((supplier) => (
                <li key={supplier.id} className={`p-4 ${!supplier.isActive ? "opacity-50" : ""}`}>
                  <div className="font-medium text-heading">{supplier.name}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-fg">
                    {supplier.phone && <span>{supplier.phone}</span>}
                    {supplier.address && <span>{supplier.address}</span>}
                  </div>
                  {canManageCatalog && (
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, supplier })}>
                        {dict.common.edit}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={togglingId === supplier.id}
                        onClick={() => toggleActive(supplier)}
                      >
                        {togglingId === supplier.id && <Loader2Icon className="size-3.5 animate-spin" />}
                        {supplier.isActive ? dict.common.deactivate : dict.common.reactivate}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <SupplierFormDialog
        open={dialogState.open}
        supplier={dialogState.supplier}
        onOpenChange={(open) => setDialogState((s) => ({ ...s, open }))}
        onSaved={handleSaved}
      />
    </div>
  );
}
