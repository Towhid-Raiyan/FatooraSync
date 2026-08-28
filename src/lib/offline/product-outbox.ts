import { offlineDb, type PendingProduct } from "./db";

// A quick-created-offline product's outbox, structurally identical to
// outbox.ts (receipts/quotations) but simpler: no per-device number lease
// (a product's client-generated id is already final and collision-free —
// see PendingProduct's doc comment in db.ts), and no X-Device-Id header,
// since idempotency here is keyed purely on the product's own id.
export async function enqueuePendingProduct(product: PendingProduct): Promise<void> {
  await offlineDb.pendingProducts.add(product);
}

export async function pendingProductCount(): Promise<number> {
  return offlineDb.pendingProducts.count();
}

// Replayed in creation order (not load-bearing for products the way it is
// for receipts' hash chain, but consistent and predictable). Each item's
// `id` is both its permanent identity and its idempotency key: a resubmit
// of an id that already exists server-side (POST /api/products) returns the
// existing row instead of erroring or duplicating.
export async function replayPendingProducts(): Promise<{ synced: number; stillPending: number; authExpired: boolean }> {
  const items = await offlineDb.pendingProducts.orderBy("createdAt").toArray();
  let synced = 0;
  let stillPending = 0;
  let authExpired = false;

  for (const product of items) {
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        body: JSON.stringify({
          id: product.id,
          nameEn: product.nameEn,
          nameAr: product.nameAr,
          barcode: product.barcode,
          unit: product.unit,
          unitPrice: product.unitPrice,
          vatRate: product.vatRate,
          quantity: product.quantity,
          lowStockThreshold: product.lowStockThreshold,
        }),
      });
      if (response.ok) {
        const saved = await response.json();
        // Replace the local cache entry's placeholder SKU (and any other
        // server-assigned fields) with the real synced values now, rather
        // than waiting for the next full syncOfflineCache() refresh.
        const cached = await offlineDb.products.get(product.id);
        if (cached) await offlineDb.products.put({ ...cached, sku: saved.sku ?? cached.sku });
        await offlineDb.pendingProducts.delete(product.id);
        synced++;
      } else {
        stillPending++;
        if (response.status === 401) authExpired = true;
      }
    } catch {
      stillPending++;
    }
  }

  return { synced, stillPending, authExpired };
}
