"use client";

import { useEffect, useState } from "react";
import { WifiOffIcon } from "lucide-react";
import { useOnlineStatus } from "@/lib/offline/connectivity";
import { pendingCount, replayPending } from "@/lib/offline/outbox";
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
      const [receipts, quotations] = await Promise.all([pendingCount("receipt"), pendingCount("quotation")]);
      if (!cancelled) setPending(receipts + quotations);
    }

    refreshCount();

    async function trySync() {
      if (!online) return;
      const [receiptResult, quotationResult] = await Promise.all([replayPending("receipt"), replayPending("quotation")]);
      if (!cancelled) setAuthExpired(receiptResult.authExpired || quotationResult.authExpired);
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
    <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm text-warning-fg">
      <WifiOffIcon className="size-4" />
      {!online
        ? dict.offline.offlineBadge
        : authExpired
          ? dict.offline.authExpiredBadge(pending)
          : dict.offline.pendingSyncBadge(pending)}
    </div>
  );
}
