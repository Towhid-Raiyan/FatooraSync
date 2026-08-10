export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface LineInput {
  unitPrice: number;
  quantity: number;
  vatRate: number;
}

export interface LineTotals {
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
}

export function calculateLine(input: LineInput): LineTotals {
  const lineSubtotal = round2(input.unitPrice * input.quantity);
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
