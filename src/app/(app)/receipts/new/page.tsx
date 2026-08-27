"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@prisma/client";
import { Loader2Icon } from "lucide-react";
import { offlineDb } from "@/lib/offline/db";
import { syncOfflineCache } from "@/lib/offline/cache-sync";
import { useOnlineStatus } from "@/lib/offline/connectivity";
import { ReceiptForm } from "@/components/receipts/receipt-form";
import type { SerializedProduct } from "@/components/products/products-client";

// This page reads its catalog/customers/settings from the local Dexie cache
// rather than from Prisma at render time, so it loads identically whether or
// not the server is reachable. When online it first refreshes that cache from
// /api/offline-data (which also tops up this device's number leases), then
// reads back from Dexie either way -- one code path, no offline special case.
export default function NewReceiptPage() {
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
    <ReceiptForm
      initialCustomers={data.customers}
      initialProducts={data.products}
      defaultVatRate={data.defaultVatRate}
    />
  );
}
