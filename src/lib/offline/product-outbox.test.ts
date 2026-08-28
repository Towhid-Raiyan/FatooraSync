import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { offlineDb, type PendingProduct } from "./db";
import { enqueuePendingProduct, replayPendingProducts, pendingProductCount } from "./product-outbox";

// Same gap as outbox.test.ts: replayPendingProducts doesn't itself call
// getDeviceId, but Vitest's node environment still has no localStorage, and a
// later test file importing this module first would otherwise leave it
// unset for any sibling module that does need it. Cheap to guard here too.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => void store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

const sampleProduct: PendingProduct = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  nameEn: "Offline Apple Juice",
  nameAr: null,
  barcode: null,
  unit: "PIECE",
  unitPrice: "5.50",
  vatRate: null,
  quantity: "0",
  lowStockThreshold: null,
  createdAt: "2026-08-28T10:00:00.000Z",
};

describe("product-outbox", () => {
  beforeEach(async () => {
    await offlineDb.pendingProducts.clear();
    await offlineDb.products.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues a pending product and reports it in the count", async () => {
    await enqueuePendingProduct(sampleProduct);
    expect(await pendingProductCount()).toBe(1);
  });

  it("replays a pending product against the real endpoint and removes it on success", async () => {
    await enqueuePendingProduct(sampleProduct);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: sampleProduct.id, sku: "SKU-000042", nameEn: sampleProduct.nameEn }),
    });

    const result = await replayPendingProducts();

    expect(result).toEqual({ synced: 1, stillPending: 0, authExpired: false });
    expect(await pendingProductCount()).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({ method: "POST" })
    );
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(JSON.parse(init.body as string).id).toBe(sampleProduct.id);
  });

  it("refreshes the local products cache entry with the server-assigned SKU on sync", async () => {
    await offlineDb.products.put({
      id: sampleProduct.id,
      nameEn: sampleProduct.nameEn,
      nameAr: null,
      sku: "(pending)",
      barcode: null,
      unitPrice: "5.50",
      vatRate: null,
      quantity: "0",
      unit: "PIECE",
      isActive: true,
    });
    await enqueuePendingProduct(sampleProduct);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: sampleProduct.id, sku: "SKU-000042" }),
    });

    await replayPendingProducts();

    const cached = await offlineDb.products.get(sampleProduct.id);
    expect(cached?.sku).toBe("SKU-000042");
  });

  it("leaves a pending product queued when the replay request fails", async () => {
    await enqueuePendingProduct(sampleProduct);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const result = await replayPendingProducts();

    expect(result).toEqual({ synced: 0, stillPending: 1, authExpired: false });
    expect(await pendingProductCount()).toBe(1);
  });

  it("flags authExpired on a 401", async () => {
    await enqueuePendingProduct(sampleProduct);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const result = await replayPendingProducts();

    expect(result).toEqual({ synced: 0, stillPending: 1, authExpired: true });
  });

  it("replays in creation order", async () => {
    await enqueuePendingProduct({ ...sampleProduct, id: "second", createdAt: "2026-08-28T11:00:00.000Z" });
    await enqueuePendingProduct({ ...sampleProduct, id: "first", createdAt: "2026-08-28T10:00:00.000Z" });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    await replayPendingProducts();

    const calls = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const replayedIds = calls.map(([, init]) => JSON.parse(init.body as string).id);
    expect(replayedIds).toEqual(["first", "second"]);
  });
});
