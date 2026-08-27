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

  await offlineDb.transaction("rw", [offlineDb.products, offlineDb.customers, offlineDb.settings, offlineDb.tenant], async () => {
    await offlineDb.products.clear();
    await offlineDb.products.bulkAdd(data.products);
    await offlineDb.customers.clear();
    await offlineDb.customers.bulkAdd(data.customers);
    await offlineDb.settings.put({ id: "singleton", ...data.settings });
    await offlineDb.tenant.put({ id: "singleton", ...data.tenant });
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
