import { describe, it, expect } from "vitest";
import { buildZatcaQrPayload } from "./qr-payload";

function decodeTlv(buffer: Buffer): Array<{ tag: number; value: string }> {
  const result: Array<{ tag: number; value: string }> = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = buffer[offset];
    const length = buffer[offset + 1];
    const value = buffer.subarray(offset + 2, offset + 2 + length).toString("utf8");
    result.push({ tag, value });
    offset += 2 + length;
  }
  return result;
}

describe("buildZatcaQrPayload", () => {
  const input = {
    sellerName: "Demo Trading Establishment",
    vatNumber: "300000000000099",
    timestamp: "2026-08-10T12:00:00.000Z",
    invoiceTotal: "115.00",
    vatTotal: "15.00",
  };

  it("round-trips through TLV decoding with the exact original field values", () => {
    const payload = buildZatcaQrPayload(input);
    const decoded = decodeTlv(Buffer.from(payload, "base64"));
    expect(decoded).toEqual([
      { tag: 1, value: input.sellerName },
      { tag: 2, value: input.vatNumber },
      { tag: 3, value: input.timestamp },
      { tag: 4, value: input.invoiceTotal },
      { tag: 5, value: input.vatTotal },
    ]);
  });

  it("produces a valid Base64 string", () => {
    const payload = buildZatcaQrPayload(input);
    expect(() => Buffer.from(payload, "base64")).not.toThrow();
    expect(payload).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("throws if a field value exceeds 255 UTF-8 bytes", () => {
    const tooLong = "x".repeat(256);
    expect(() => buildZatcaQrPayload({ ...input, sellerName: tooLong })).toThrow();
  });
});
