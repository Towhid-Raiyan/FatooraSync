export interface QrPayloadInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string; // ISO 8601
  invoiceTotal: string;
  vatTotal: string;
}

const textEncoder = new TextEncoder();

function encodeTlv(tag: number, value: string): Uint8Array {
  const valueBytes = textEncoder.encode(value);
  if (valueBytes.length > 255) {
    throw new Error(`ZATCA QR field for tag ${tag} exceeds the 255-byte TLV length limit`);
  }
  const out = new Uint8Array(2 + valueBytes.length);
  out[0] = tag;
  out[1] = valueBytes.length;
  out.set(valueBytes, 2);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa is a browser/Node-both global as of Node 18+ (this project's floor,
  // confirmed via next.config.ts's supported runtime) -- no polyfill needed.
  return btoa(binary);
}

// Standard ZATCA Phase-1 simplified-invoice QR structure: 5 TLV (Tag-Length-Value)
// fields concatenated in tag order, then Base64-encoded as a whole. Pure local
// computation, no external ZATCA API dependency. Deliberately Buffer-free so it
// can also run in a browser bundle (the offline print path calls this
// client-side -- see src/lib/offline/print-data.ts).
export function buildZatcaQrPayload(input: QrPayloadInput): string {
  const tlvs = [
    encodeTlv(1, input.sellerName),
    encodeTlv(2, input.vatNumber),
    encodeTlv(3, input.timestamp),
    encodeTlv(4, input.invoiceTotal),
    encodeTlv(5, input.vatTotal),
  ];
  const totalLength = tlvs.reduce((sum, t) => sum + t.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const t of tlvs) {
    combined.set(t, offset);
    offset += t.length;
  }
  return bytesToBase64(combined);
}
