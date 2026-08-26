import bwipjs from "bwip-js/node";

// Code128 handles arbitrary alphanumeric text (unlike EAN/UPC, which need a
// fixed-length numeric input), so it works whether the barcode content is a
// real scanned manufacturer code or a generated fallback like a SKU string
// ("SKU-000012") -- see resolve-label-barcode.ts for how that value is chosen.
export async function generateBarcodeDataUrl(text: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text,
    scale: 3,
    height: 10,
    includetext: false,
    backgroundcolor: "FFFFFF",
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}
