import { offlineDb } from "./db";
import { getDeviceId } from "./device-id";
import { remainingCapacity, storeLeasedBlock } from "./lease-store";

const REFILL_THRESHOLD = 5;

// Called whenever /receipts/new or /quotations/new load successfully online
// (Task 13). Mirrors the current catalog/customers/settings/tenant into
// Dexie, and tops up this device's number leases if they're running low --
// both as ordinary side effects of normal page usage, not a separate
// background job.
export async function syncOfflineCache(): Promise<void> {
  const response = await fetch("/api/offline-data");
  if (!response.ok) return;
  const data = await response.json();

  // Spec §4.2 requires the local cache be keyed by tenant. Dexie is per-origin,
  // not per-account, so one physical device signed into a second tenant's
  // account would otherwise inherit the first tenant's catalog AND -- far worse
  // -- its number leases: `remainingCapacity()` would see tenant A's unused
  // block, skip the refill, and hand tenant B's cashier a number belonging to
  // tenant A, which the server's lease-ownership check then rejects forever
  // with no way for the client to explain why. So a tenant switch wipes every
  // table, not just the catalog ones.
  const cachedTenant = await offlineDb.tenant.get("singleton");
  const isTenantSwitch = cachedTenant !== undefined && cachedTenant.tenantId !== data.tenant.id;

  if (isTenantSwitch) {
    // ...with one exception. If this device still has unsynced sales queued for
    // the PREVIOUS tenant, wiping the outbox would destroy real, already-printed
    // revenue, and wiping the leases would destroy the only thing that can still
    // sync it (those numbers were genuinely leased to this device by tenant A,
    // so they remain valid for tenant A). Between silently losing sales and
    // leaving a device on a stale cache, stale-but-recoverable is the only
    // acceptable choice: skip the switch entirely and let the outbox keep
    // draining against tenant A. A device stuck in this state -- signed into B
    // with undrainable A sales -- is a genuine edge case for a human to resolve
    // (sign back into A, let it sync, then switch), and it is deliberately made
    // visible by the cache staying stale rather than made invisible by a
    // silent delete.
    const [pendingReceipts, pendingQuotations] = await Promise.all([
      offlineDb.pendingReceipts.count(),
      offlineDb.pendingQuotations.count(),
    ]);
    if (pendingReceipts > 0 || pendingQuotations > 0) return;

    await offlineDb.transaction(
      "rw",
      [offlineDb.products, offlineDb.customers, offlineDb.settings, offlineDb.tenant, offlineDb.numberLeases, offlineDb.pendingReceipts, offlineDb.pendingQuotations],
      async () => {
        await Promise.all([
          offlineDb.products.clear(),
          offlineDb.customers.clear(),
          offlineDb.settings.clear(),
          offlineDb.tenant.clear(),
          offlineDb.numberLeases.clear(),
          offlineDb.pendingReceipts.clear(),
          offlineDb.pendingQuotations.clear(),
        ]);
      }
    );
  }

  await offlineDb.transaction("rw", [offlineDb.products, offlineDb.customers, offlineDb.settings, offlineDb.tenant], async () => {
    await offlineDb.products.clear();
    await offlineDb.products.bulkAdd(data.products);
    await offlineDb.customers.clear();
    await offlineDb.customers.bulkAdd(data.customers);
    await offlineDb.settings.put({ id: "singleton", ...data.settings });
    // `id` stays the fixed "singleton" primary key (every reader does
    // `.get("singleton")`); the tenant's real id is carried separately in
    // `tenantId` purely for the switch detection above. The explicit `id` must
    // come after the spread -- `data.tenant` now carries a real `id` field of
    // its own, which would otherwise clobber the primary key.
    await offlineDb.tenant.put({ ...data.tenant, id: "singleton", tenantId: data.tenant.id });
  });

  await refillLeaseIfLow("SALES_RECEIPT", "/api/receipts/lease-numbers");
  await refillLeaseIfLow("QUOTATION", "/api/quotations/lease-numbers");
}

async function refillLeaseIfLow(documentType: "SALES_RECEIPT" | "QUOTATION", endpoint: string): Promise<void> {
  const remaining = await remainingCapacity(documentType);
  if (remaining >= REFILL_THRESHOLD) return;
  const response = await fetch(endpoint, { method: "POST", headers: { "X-Device-Id": getDeviceId() } });
  if (!response.ok) return;
  const { rangeStart, rangeEnd } = await response.json();
  await storeLeasedBlock(documentType, rangeStart, rangeEnd);
}
