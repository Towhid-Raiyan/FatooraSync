import { describe, it, expect } from "vitest";
import { computeInvoiceHash, GENESIS_HASH } from "./hash-chain";

describe("computeInvoiceHash", () => {
  const baseInput = {
    previousInvoiceHash: null as string | null,
    uuid: "11111111-1111-1111-1111-111111111111",
    grandTotal: "115.00",
    vatTotal: "15.00",
    createdAt: "2026-08-10T12:00:00.000Z",
  };

  it("is deterministic for the same input", () => {
    expect(computeInvoiceHash(baseInput)).toBe(computeInvoiceHash(baseInput));
  });

  it("treats a null previousInvoiceHash the same as the genesis hash", () => {
    const withNull = computeInvoiceHash({ ...baseInput, previousInvoiceHash: null });
    const withGenesis = computeInvoiceHash({ ...baseInput, previousInvoiceHash: GENESIS_HASH });
    expect(withNull).toBe(withGenesis);
  });

  it("produces a different hash for a different previousInvoiceHash", () => {
    const first = computeInvoiceHash({ ...baseInput, previousInvoiceHash: null });
    const second = computeInvoiceHash({ ...baseInput, previousInvoiceHash: "some-prior-hash" });
    expect(first).not.toBe(second);
  });

  it("produces a different hash for a different grandTotal", () => {
    const first = computeInvoiceHash(baseInput);
    const second = computeInvoiceHash({ ...baseInput, grandTotal: "200.00" });
    expect(first).not.toBe(second);
  });

  it("produces a 64-character lowercase hex string (SHA-256)", () => {
    expect(computeInvoiceHash(baseInput)).toMatch(/^[0-9a-f]{64}$/);
  });
});
