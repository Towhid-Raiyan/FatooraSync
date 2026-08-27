"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@prisma/client";
import { Loader2Icon } from "lucide-react";
import { offlineDb } from "@/lib/offline/db";
import { syncOfflineCache } from "@/lib/offline/cache-sync";
import { useOnlineStatus } from "@/lib/offline/connectivity";
import { QuotationForm } from "@/components/quotations/quotation-form";
import type { SerializedProduct } from "@/components/products/products-client";

// Same client-fetched shape as /receipts/new -- see the note there. Both pages
// share one cache (/api/offline-data), since the data a cashier needs to build
// a quotation is identical to what they need to build a receipt.
export default function NewQuotationPage() {
  const online = useOnlineStatus();
  const [data, setData] = useState<{
    customers: Customer[];
    products: SerializedProduct[];
    defaultVatRate: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (online) {
        try {
          await syncOfflineCache();
        } catch {
          // Fall through to the Dexie read below -- a failed cache refresh
          // (e.g. connectivity dropped mid-request) shouldn't block the page
          // from rendering whatever was already cached from a prior visit.
        }
      }
      const [products, customers, settings] = await Promise.all([
        offlineDb.products.toArray(),
        offlineDb.customers.toArray(),
        offlineDb.settings.get("singleton"),
      ]);
      if (!cancelled) {
        setData({
          products: products as unknown as SerializedProduct[],
          customers: customers as unknown as Customer[],
          defaultVatRate: settings?.defaultVatRate ?? "15",
        });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [online]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="size-6 animate-spin text-muted-fg" />
      </div>
    );
  }

  return (
    <QuotationForm
      initialCustomers={data.customers}
      initialProducts={data.products}
      defaultVatRate={data.defaultVatRate}
    />
  );
}
