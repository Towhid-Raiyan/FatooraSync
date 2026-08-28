"use client";

import { useEffect, useState } from "react";
import { WifiOffIcon } from "lucide-react";
import { useOnlineStatus } from "@/lib/offline/connectivity";
import { pendingCount, replayPending } from "@/lib/offline/outbox";
import { pendingProductCount, replayPendingProducts } from "@/lib/offline/product-outbox";
import { useLocale } from "@/lib/i18n/language-provider";

const RETRY_INTERVAL_MS = 30000;

export function OfflineStatusIndicator() {
  const { dict } = useLocale();
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refreshCount() {
      const [receipts, quotations, products] = await Promise.all([
        pendingCount("receipt"),
        pendingCount("quotation"),
        pendingProductCount(),
      ]);
      if (!cancelled) setPending(receipts + quotations + products);
    }

    refreshCount();

    async function trySync() {
      if (!online) return;
      // Products first, awaited, before receipts/quotations: a sale that
      // quick-created a product offline references it by an id the server
      // doesn't have yet, so the product must land server-side first, or the
      // sale's replay 400s ("no longer available") and just retries next
      // cycle instead of succeeding immediately.
      const productResult = await replayPendingProducts();
      const [receiptResult, quotationResult] = await Promise.all([replayPending("receipt"), replayPending("quotation")]);
      if (!cancelled) setAuthExpired(productResult.authExpired || receiptResult.authExpired || quotationResult.authExpired);
      await refreshCount();
    }

    trySync();
    const interval = setInterval(trySync, RETRY_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [online]);

  if (online && pending === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
      <WifiOffIcon className="size-4" />
      {!online
        ? dict.offline.offlineBadge
        : authExpired
          ? dict.offline.authExpiredBadge(pending)
          : dict.offline.pendingSyncBadge(pending)}
    </div>
  );
}
