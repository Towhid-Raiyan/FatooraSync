import { describe, it, expect } from "vitest";
import { buildZatcaQrPayload } from "./qr-payload";

describe("buildZatcaQrPayload", () => {
  it("matches the known-good Phase-1 TLV/Base64 output for a simple invoice", () => {
    const result = buildZatcaQrPayload({
      sellerName: "Acme Retail",
      vatNumber: "300000000000003",
      timestamp: "2026-08-27T10:00:00.000Z",
      invoiceTotal: "115.00",
      vatTotal: "15.00",
    });
    // Same fixed input as this function has always accepted -- this value is
    // computed once from the pre-refactor Buffer-based implementation and
    // pinned here so the Uint8Array rewrite can't silently change output.
    expect(result).toBe(
      Buffer.concat([
        Buffer.from([1, 11]), Buffer.from("Acme Retail", "utf8"),
        Buffer.from([2, 15]), Buffer.from("300000000000003", "utf8"),
        Buffer.from([3, 24]), Buffer.from("2026-08-27T10:00:00.000Z", "utf8"),
        Buffer.from([4, 6]), Buffer.from("115.00", "utf8"),
        Buffer.from([5, 5]), Buffer.from("15.00", "utf8"),
      ]).toString("base64")
    );
  });

  it("throws when a field exceeds the 255-byte TLV length limit", () => {
    expect(() =>
      buildZatcaQrPayload({
        sellerName: "x".repeat(256),
        vatNumber: "300000000000003",
        timestamp: "2026-08-27T10:00:00.000Z",
        invoiceTotal: "1.00",
        vatTotal: "0.15",
      })
    ).toThrow(/255-byte/);
  });
});
