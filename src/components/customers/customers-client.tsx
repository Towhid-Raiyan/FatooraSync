"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useLocale } from "@/lib/i18n/language-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { CustomerFormDialog } from "./customer-form-dialog";

export function CustomersClient({
  initialCustomers,
  canManageCatalog,
}: {
  initialCustomers: Customer[];
  canManageCatalog: boolean;
}) {
  const { dict } = useLocale();
  const { toast } = useToast();
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogState, setDialogState] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (!showInactive && !c.isActive) return false;
        if (!query) return true;
        return (
          c.name.toLowerCase().includes(query) ||
          (c.vatId ?? "").toLowerCase().includes(query) ||
          (c.phone ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, search, showInactive]);

  const hasAnyRealCustomer = customers.some((c) => !c.isWalkIn);

  function handleSaved(customer: Customer) {
    setCustomers((prev) => {
      const exists = prev.some((c) => c.id === customer.id);
      return exists ? prev.map((c) => (c.id === customer.id ? customer : c)) : [...prev, customer];
    });
    setDialogState({ open: false, customer: null });
    toast.success(dict.customers.savedToast);
  }

  function openDeleteDialog(customer: Customer) {
    setDeleteTarget(customer);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/customers/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setDeleteError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      setCustomers((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success(dict.customers.deletedToast);
    } catch {
      setDeleteError(dict.common.somethingWentWrong);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder={dict.customers.searchPlaceholder}
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
          <Button variant="primary" onClick={() => setDialogState({ open: true, customer: null })}>
            + {dict.customers.dialogTitleAdd}
          </Button>
        )}
      </div>

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {!hasAnyRealCustomer ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">{dict.customers.noCustomersYet}</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{dict.customers.name}</TableHead>
                    <TableHead>{dict.customers.vatId}</TableHead>
                    <TableHead>{dict.customers.crNumber}</TableHead>
                    <TableHead>{dict.customers.phone}</TableHead>
                    <TableHead>{dict.customers.address}</TableHead>
                    <TableHead className="text-right">{dict.common.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((customer) => (
                    <TableRow key={customer.id} className={!customer.isActive ? "opacity-50" : undefined}>
                      <TableCell className="font-medium text-heading">
                        {customer.name}
                        {customer.isWalkIn && (
                          <Badge variant="secondary" className="ms-2">
                            {dict.customers.systemBadge}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{customer.vatId ?? "—"}</TableCell>
                      <TableCell>{customer.crNumber ?? "—"}</TableCell>
                      <TableCell>{customer.phone ?? "—"}</TableCell>
                      <TableCell>{customer.address ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {!customer.isWalkIn && canManageCatalog && (
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, customer })}>
                              {dict.common.edit}
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => openDeleteDialog(customer)}>
                              {dict.common.delete}
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
              {filtered.map((customer) => (
                <li key={customer.id} className={`p-4 ${!customer.isActive ? "opacity-50" : ""}`}>
                  <div className="font-medium text-heading">
                    {customer.name}
                    {customer.isWalkIn && (
                      <Badge variant="secondary" className="ms-2">
                        {dict.customers.systemBadge}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-fg">
                    {customer.vatId && <span>{dict.customers.vatId}: {customer.vatId}</span>}
                    {customer.phone && <span>{customer.phone}</span>}
                    {customer.address && <span>{customer.address}</span>}
                  </div>
                  {!customer.isWalkIn && canManageCatalog && (
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, customer })}>
                        {dict.common.edit}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => openDeleteDialog(customer)}>
                        {dict.common.delete}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <CustomerFormDialog
        open={dialogState.open}
        customer={dialogState.customer}
        onOpenChange={(open) => setDialogState((s) => ({ ...s, open }))}
        onSaved={handleSaved}
      />

      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={dict.customers.deleteConfirmTitle}
        description={dict.customers.deleteConfirmDescription}
        details={
          deleteTarget
            ? [
                { label: dict.customers.name, value: deleteTarget.name },
                { label: dict.customers.vatId, value: deleteTarget.vatId ?? "—" },
                { label: dict.customers.phone, value: deleteTarget.phone ?? "—" },
              ]
            : []
        }
        error={deleteError}
        deleting={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
