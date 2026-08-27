import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { offlineDb, type PendingDocument } from "./db";
import { enqueuePending, replayPending, pendingCount } from "./outbox";

// replayPending calls getDeviceId() (Task 7), which reads/writes localStorage.
// Vitest's `environment: "node"` (vitest.config.ts) has no such global -- unlike
// Task 7/8's tests, this is the first suite that exercises getDeviceId, so the
// gap hasn't surfaced before. Without this, every fetch call throws before it's
// even made (ReferenceError: localStorage is not defined), landing in
// replayPending's catch block regardless of the mocked response and masking
// the very success/failure/401 branching these tests check.
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

const sampleDoc: PendingDocument = {
  uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  number: 8,
  customer: { name: "", vatId: "", crNumber: "", phone: "", address: "" },
  lines: [{ productId: "prod-1", quantity: 2, discount: 0, unitPrice: 10 }],
  notes: "",
  createdAt: "2026-08-27T10:00:00.000Z",
  status: "pending",
};

describe("outbox", () => {
  beforeEach(async () => {
    await offlineDb.pendingReceipts.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues a pending receipt and reports it in the count", async () => {
    await enqueuePending("receipt", sampleDoc);
    expect(await pendingCount("receipt")).toBe(1);
  });

  it("replays a pending receipt against the real endpoint and removes it on success", async () => {
    await enqueuePending("receipt", sampleDoc);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "doc-1", number: 8 }) });

    const result = await replayPending("receipt");

    expect(result).toEqual({ synced: 1, stillPending: 0, authExpired: false });
    expect(await pendingCount("receipt")).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/receipts",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("leaves a pending receipt queued when the replay request fails", async () => {
    await enqueuePending("receipt", sampleDoc);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const result = await replayPending("receipt");

    expect(result).toEqual({ synced: 0, stillPending: 1, authExpired: false });
    expect(await pendingCount("receipt")).toBe(1);
  });

  it("does not double-count an item that fails, then succeeds on a later replay", async () => {
    await enqueuePending("receipt", sampleDoc);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await replayPending("receipt");

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "doc-1", number: 8 }) });
    const result = await replayPending("receipt");

    expect(result).toEqual({ synced: 1, stillPending: 0, authExpired: false });
  });

  it("sends the sale's original createdAt so the server can't restamp it at sync time", async () => {
    await enqueuePending("receipt", sampleDoc);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "doc-1", number: 8 }) });

    await replayPending("receipt");

    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(JSON.parse(init.body as string).createdAt).toBe("2026-08-27T10:00:00.000Z");
  });

  it("replays in creation order, not uuid order", async () => {
    // Deliberately reversed: the uuid that sorts FIRST lexicographically is the
    // sale made SECOND. Ordering by uuid (as an earlier version did) would
    // replay these backwards, chaining the later receipt off the earlier one's
    // hash-chain predecessor.
    await enqueuePending("receipt", { ...sampleDoc, uuid: "aaaa-second", number: 9, createdAt: "2026-08-27T11:00:00.000Z" });
    await enqueuePending("receipt", { ...sampleDoc, uuid: "zzzz-first", number: 8, createdAt: "2026-08-27T10:00:00.000Z" });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    await replayPending("receipt");

    const calls = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const replayedUuids = calls.map(([, init]) => JSON.parse(init.body as string).preAssigned.uuid);
    expect(replayedUuids).toEqual(["zzzz-first", "aaaa-second"]);
  });

  it("flags authExpired on a 401 instead of a generic pending state", async () => {
    await enqueuePending("receipt", sampleDoc);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const result = await replayPending("receipt");

    expect(result).toEqual({ synced: 0, stillPending: 1, authExpired: true });
    expect(await pendingCount("receipt")).toBe(1);
  });
});
