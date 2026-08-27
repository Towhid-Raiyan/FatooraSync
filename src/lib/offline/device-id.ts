const STORAGE_KEY = "fatoorasync-device-id";

// One stable UUID per browser/installed-PWA instance, generated once and
// reused forever after -- this is what a NumberLease is reserved against
// (src/lib/receipts/lease-block.ts) and what the server validates a
// pre-assigned number's ownership against (src/app/api/receipts/route.ts).
export function getDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, generated);
  return generated;
}
