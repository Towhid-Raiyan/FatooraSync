export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface LineInput {
  unitPrice: number;
  quantity: number;
  vatRate: number;
  discount: number;
}

export interface LineTotals {
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
}

// `discount` is a flat SAR amount taken off the line before VAT is computed --
// VAT is charged on the post-discount amount, standard tax practice. A discount
// that exceeds the raw subtotal is not clamped here (this is a pure function);
// callers are responsible for validating discount <= unitPrice * quantity
// before relying on the result.
export function calculateLine(input: LineInput): LineTotals {
  const rawSubtotal = round2(input.unitPrice * input.quantity);
  const lineSubtotal = round2(rawSubtotal - input.discount);
  const lineVat = round2((lineSubtotal * input.vatRate) / 100);
  const lineTotal = round2(lineSubtotal + lineVat);
  return { lineSubtotal, lineVat, lineTotal };
}

export interface DocumentTotals {
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
}

export function calculateDocumentTotals(lines: LineTotals[]): DocumentTotals {
  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineSubtotal, 0));
  const vatTotal = round2(lines.reduce((sum, line) => sum + line.lineVat, 0));
  const grandTotal = round2(subtotal + vatTotal);
  return { subtotal, vatTotal, grandTotal };
}
