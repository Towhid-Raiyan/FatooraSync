"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@prisma/client";
import { Loader2Icon } from "lucide-react";
import { offlineDb } from "@/lib/offline/db";
import { syncOfflineCache } from "@/lib/offline/cache-sync";
import { useOnlineStatus } from "@/lib/offline/connectivity";
import { useLocale } from "@/lib/i18n/language-provider";
import { ReceiptForm } from "@/components/receipts/receipt-form";
import type { SerializedProduct } from "@/components/products/products-client";

// This page reads its catalog/customers/settings from the local Dexie cache
// rather than from Prisma at render time, so it loads identically whether or
// not the server is reachable. When online it first refreshes that cache from
// /api/offline-data (which also tops up this device's number leases), then
// reads back from Dexie either way -- one code path, no offline special case.
export default function NewReceiptPage() {
  const { dict } = useLocale();
  const online = useOnlineStatus();
  const [data, setData] = useState<{
    customers: Customer[];
    products: SerializedProduct[];
    defaultVatRate: string;
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

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

      // Dexie returns rows in primary-key (cuid) order, so both lists have to be
      // re-sorted by name here to preserve what the server queries this page
      // replaced did with `orderBy: { nameEn | name: "asc" }`. Not cosmetic:
      // customer-section.tsx takes `.slice(0, 8)` of the filtered suggestions,
      // so an arbitrary order silently changes *which* customers a cashier can
      // pick once a typed prefix matches more than eight of them. Sorted in JS
      // rather than via Dexie's `.orderBy()` because neither `nameEn` nor `name`
      // is a declared index in the schema (src/lib/offline/db.ts).
      products.sort((a, b) => a.nameEn.localeCompare(b.nameEn));
      customers.sort((a, b) => a.name.localeCompare(b.name));

      if (!cancelled) {
        setData({
          products: products as unknown as SerializedProduct[],
          customers: customers as unknown as Customer[],
          defaultVatRate: settings?.defaultVatRate ?? "15",
        });
      }
    }

    // IndexedDB isn't universally available (some enterprise device policies and
    // embedded webviews block it outright). Without this the page would sit on
    // the spinner forever on an unhandled rejection -- worse than the plain
    // error the server component this replaced would have produced.
    load().catch(() => {
      if (!cancelled) setLoadFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [online]);

  if (loadFailed) {
    return (
      <div className="flex items-center justify-center py-24">
        <p role="alert" className="text-sm text-red-600">
          {dict.common.somethingWentWrong}
        </p>
      </div>
    );
  }

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
