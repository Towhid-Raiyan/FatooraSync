"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface CustomerDraft {
  name: string;
  vatId: string;
  crNumber: string;
  phone: string;
  address: string;
}

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

interface CustomerSectionProps {
  customers: Customer[];
  draft: CustomerDraft;
  onDraftChange: (draft: CustomerDraft) => void;
}

function fillFromCustomer(customer: Customer): CustomerDraft {
  return {
    name: customer.name,
    vatId: customer.vatId ?? "",
    crNumber: customer.crNumber ?? "",
    phone: customer.phone ?? "",
    address: customer.address ?? "",
  };
}

export function CustomerSection({ customers, draft, onDraftChange }: CustomerSectionProps) {
  const [nameSuggestionsOpen, setNameSuggestionsOpen] = useState(false);
  const [vatSuggestionsOpen, setVatSuggestionsOpen] = useState(false);

  const nameMatches = useMemo(() => {
    const query = draft.name.trim().toLowerCase();
    if (!query) return [];
    return customers.filter((c) => !c.isWalkIn && c.name.toLowerCase().includes(query)).slice(0, 8);
  }, [customers, draft.name]);

  const vatMatches = useMemo(() => {
    const query = draft.vatId.trim().toLowerCase();
    if (!query) return [];
    return customers.filter((c) => !c.isWalkIn && (c.vatId ?? "").toLowerCase().includes(query)).slice(0, 8);
  }, [customers, draft.vatId]);

  function selectSuggestion(customer: Customer) {
    onDraftChange(fillFromCustomer(customer));
    setNameSuggestionsOpen(false);
    setVatSuggestionsOpen(false);
  }

  return (
    <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">Customer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <Label className={LABEL_CLASS}>Name</Label>
            <Input
              value={draft.name}
              onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
              onFocus={() => setNameSuggestionsOpen(true)}
              onBlur={() => setTimeout(() => setNameSuggestionsOpen(false), 150)}
              autoComplete="off"
            />
            {nameSuggestionsOpen && nameMatches.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
                {nameMatches.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onMouseDown={() => selectSuggestion(customer)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-bg-app"
                  >
                    <span className="text-heading">{customer.name}</span>
                    {customer.vatId && <span className="text-muted-fg"> — {customer.vatId}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <Label className={LABEL_CLASS}>VAT ID</Label>
            <Input
              value={draft.vatId}
              onChange={(e) => onDraftChange({ ...draft, vatId: e.target.value })}
              onFocus={() => setVatSuggestionsOpen(true)}
              onBlur={() => setTimeout(() => setVatSuggestionsOpen(false), 150)}
              autoComplete="off"
            />
            {vatSuggestionsOpen && vatMatches.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
                {vatMatches.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onMouseDown={() => selectSuggestion(customer)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-bg-app"
                  >
                    <span className="text-heading">{customer.vatId}</span>
                    <span className="text-muted-fg"> — {customer.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label className={LABEL_CLASS}>CR Number</Label>
            <Input
              value={draft.crNumber}
              onChange={(e) => onDraftChange({ ...draft, crNumber: e.target.value })}
            />
          </div>
          <div>
            <Label className={LABEL_CLASS}>Phone</Label>
            <Input value={draft.phone} onChange={(e) => onDraftChange({ ...draft, phone: e.target.value })} />
          </div>
        </div>
        <div>
          <Label className={LABEL_CLASS}>Address</Label>
          <Input value={draft.address} onChange={(e) => onDraftChange({ ...draft, address: e.target.value })} />
        </div>
      </CardContent>
    </Card>
  );
}
