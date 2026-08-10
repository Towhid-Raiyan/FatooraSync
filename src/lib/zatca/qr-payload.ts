export interface QrPayloadInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string; // ISO 8601
  invoiceTotal: string;
  vatTotal: string;
}

function encodeTlv(tag: number, value: string): Buffer {
  const valueBytes = Buffer.from(value, "utf8");
  if (valueBytes.length > 255) {
    throw new Error(`ZATCA QR field for tag ${tag} exceeds the 255-byte TLV length limit`);
  }
  return Buffer.concat([Buffer.from([tag, valueBytes.length]), valueBytes]);
}

// Standard ZATCA Phase-1 simplified-invoice QR structure: 5 TLV (Tag-Length-Value)
// fields concatenated in tag order, then Base64-encoded as a whole. Pure local
// computation, no external ZATCA API dependency.
export function buildZatcaQrPayload(input: QrPayloadInput): string {
  const tlvs = [
    encodeTlv(1, input.sellerName),
    encodeTlv(2, input.vatNumber),
    encodeTlv(3, input.timestamp),
    encodeTlv(4, input.invoiceTotal),
    encodeTlv(5, input.vatTotal),
  ];
  return Buffer.concat(tlvs).toString("base64");
}
