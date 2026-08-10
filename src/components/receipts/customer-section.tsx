"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface NewCustomerDraft {
  name: string;
  vatId: string;
  crNumber: string;
  phone: string;
  address: string;
}

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

interface CustomerSectionProps {
  customers: Customer[];
  selectedCustomerId: string | null;
  addingNew: boolean;
  newCustomerDraft: NewCustomerDraft;
  onSelectCustomer: (id: string) => void;
  onStartAddNew: () => void;
  onCancelAddNew: () => void;
  onNewCustomerDraftChange: (draft: NewCustomerDraft) => void;
}

export function CustomerSection({
  customers,
  selectedCustomerId,
  addingNew,
  newCustomerDraft,
  onSelectCustomer,
  onStartAddNew,
  onCancelAddNew,
  onNewCustomerDraftChange,
}: CustomerSectionProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(query) || (c.vatId ?? "").toLowerCase().includes(query)
    );
  }, [customers, search]);

  const selected = customers.find((c) => c.id === selectedCustomerId) ?? null;

  return (
    <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">Customer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {addingNew ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={LABEL_CLASS}>Name</Label>
                <Input
                  value={newCustomerDraft.name}
                  onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label className={LABEL_CLASS}>VAT ID</Label>
                <Input
                  value={newCustomerDraft.vatId}
                  onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, vatId: e.target.value })}
                />
              </div>
              <div>
                <Label className={LABEL_CLASS}>CR Number</Label>
                <Input
                  value={newCustomerDraft.crNumber}
                  onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, crNumber: e.target.value })}
                />
              </div>
              <div>
                <Label className={LABEL_CLASS}>Phone</Label>
                <Input
                  value={newCustomerDraft.phone}
                  onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, phone: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label className={LABEL_CLASS}>Address</Label>
              <Input
                value={newCustomerDraft.address}
                onChange={(e) => onNewCustomerDraftChange({ ...newCustomerDraft, address: e.target.value })}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onCancelAddNew}>
              Cancel, pick an existing customer instead
            </Button>
          </>
        ) : (
          <>
            <Input
              placeholder="Search by name or VAT ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {selected && (
              <div className="rounded-lg border border-border-subtle p-3 text-sm">
                <div className="font-medium text-heading">{selected.name}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-fg">
                  <div>VAT ID: {selected.vatId ?? "—"}</div>
                  <div>CR Number: {selected.crNumber ?? "—"}</div>
                  <div>Phone: {selected.phone ?? "—"}</div>
                  <div>Address: {selected.address ?? "—"}</div>
                </div>
              </div>
            )}
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border-subtle">
              {filtered.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => onSelectCustomer(customer.id)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-bg-app ${
                    customer.id === selectedCustomerId ? "bg-bg-app font-medium text-heading" : "text-body"
                  }`}
                >
                  {customer.name}
                  {customer.vatId && <span className="text-muted-fg"> — {customer.vatId}</span>}
                </button>
              ))}
              {filtered.length === 0 && <div className="px-3 py-2 text-sm text-muted-fg">No matches</div>}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onStartAddNew}>
              + Add new customer
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
