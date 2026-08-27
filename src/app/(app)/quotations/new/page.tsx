"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@prisma/client";
import { Loader2Icon } from "lucide-react";
import { offlineDb } from "@/lib/offline/db";
import { syncOfflineCache } from "@/lib/offline/cache-sync";
import { useOnlineStatus } from "@/lib/offline/connectivity";
import { useLocale } from "@/lib/i18n/language-provider";
import { QuotationForm } from "@/components/quotations/quotation-form";
import type { SerializedProduct } from "@/components/products/products-client";

// Same client-fetched shape as /receipts/new -- see the notes there. Both pages
// share one cache (/api/offline-data), since the data a cashier needs to build
// a quotation is identical to what they need to build a receipt.
export default function NewQuotationPage() {
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

      // Re-sorted by name because Dexie returns primary-key (cuid) order -- see
      // the fuller note in src/app/(app)/receipts/new/page.tsx.
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
    <QuotationForm
      initialCustomers={data.customers}
      initialProducts={data.products}
      defaultVatRate={data.defaultVatRate}
    />
  );
}
