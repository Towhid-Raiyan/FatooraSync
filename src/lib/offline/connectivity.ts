"use client";

import { useEffect, useState } from "react";

const HEALTH_CHECK_INTERVAL_MS = 15000;

// navigator.onLine alone is unreliable -- it can report "online" when Wi-Fi
// is connected but the app's own server is unreachable. This pairs it with a
// real periodic ping to /api/health (a trivial, unauthenticated, no-DB
// endpoint -- see src/app/api/health/route.ts) so the offline outbox and
// status indicator react to the connectivity that actually matters.
async function pingHealth(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export function subscribeOnlineStatus(callback: (online: boolean) => void): () => void {
  let cancelled = false;

  async function check() {
    const reachable = navigator.onLine && (await pingHealth());
    if (!cancelled) callback(reachable);
  }

  check();
  const interval = setInterval(check, HEALTH_CHECK_INTERVAL_MS);
  window.addEventListener("online", check);
  window.addEventListener("offline", check);

  return () => {
    cancelled = true;
    clearInterval(interval);
    window.removeEventListener("online", check);
    window.removeEventListener("offline", check);
  };
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => subscribeOnlineStatus(setOnline), []);

  return online;
}
