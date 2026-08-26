import { round2 } from "@/lib/receipts/calculate-totals";

// Product.unitPrice is stored VAT-exclusive (VAT is calculated separately per
// receipt line). A price label is a shelf/retail price, which Saudi VAT rules
// require to be shown inclusive of tax -- so this is deliberately NOT the raw
// unitPrice, unlike most other places in the app that work with the
// pre-VAT figure directly.
export function calculateLabelPrice(unitPrice: number, vatRate: number | null, defaultVatRate: number): number {
  const rate = vatRate ?? defaultVatRate;
  return round2(unitPrice * (1 + rate / 100));
}
