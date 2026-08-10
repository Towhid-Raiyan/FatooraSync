"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { CustomerFormDialog } from "./customer-form-dialog";

export function CustomersClient({ initialCustomers }: { initialCustomers: Customer[] }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogState, setDialogState] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });
  const [actionError, setActionError] = useState<string | null>(null);

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
  }

  async function toggleActive(customer: Customer) {
    setActionError(null);
    try {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !customer.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? "Something went wrong");
        return;
      }
      const updated = await response.json();
      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      setActionError("Something went wrong");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search by name, VAT ID, or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
          <label className="flex items-center gap-2 text-sm text-body">
            <Checkbox checked={showInactive} onCheckedChange={(checked) => setShowInactive(checked === true)} />
            Show inactive
          </label>
        </div>
        <Button variant="primary" onClick={() => setDialogState({ open: true, customer: null })}>
          + Add Customer
        </Button>
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-red-600">
          {actionError}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {!hasAnyRealCustomer ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">No customers yet — add your first one</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>VAT ID</TableHead>
                <TableHead>CR Number</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((customer) => (
                <TableRow key={customer.id} className={!customer.isActive ? "opacity-50" : undefined}>
                  <TableCell className="font-medium text-heading">
                    {customer.name}
                    {customer.isWalkIn && (
                      <Badge variant="secondary" className="ms-2">
                        System
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{customer.vatId ?? "—"}</TableCell>
                  <TableCell>{customer.crNumber ?? "—"}</TableCell>
                  <TableCell>{customer.phone ?? "—"}</TableCell>
                  <TableCell>{customer.address ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {!customer.isWalkIn && (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, customer })}>
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleActive(customer)}>
                          {customer.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <CustomerFormDialog
        open={dialogState.open}
        customer={dialogState.customer}
        onOpenChange={(open) => setDialogState((s) => ({ ...s, open }))}
        onSaved={handleSaved}
      />
    </div>
  );
}
