export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Unit price alone carries an extra decimal (thousandths) so a typed line
// Total can round-trip back to an exact unit price: at 2dp, back-solving a
// unit price from a target total often can't reproduce that total exactly
// (e.g. 5 units, 75.00 target, 15% VAT -> best 2dp candidate forward-computes
// to 74.98). Every other money value (line/document subtotal, VAT, total)
// stays at round2 -- customers still see a normal 2-decimal invoice.
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
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

export interface LineFromTotalInput {
  lineTotal: number;
  quantity: number;
  discount: number;
  vatRate: number;
}

export interface LineTotalsFromTotal extends LineTotals {
  unitPrice: number;
}

// For a line where the cashier typed a Total directly instead of a unit price.
// `calculateLine` computes subtotal-first: round the raw subtotal, then round
// VAT from that already-rounded subtotal, then sum. That direction has genuine
// gaps -- for some quantity/VAT-rate/total combinations, NO unit price at any
// precision forward-computes through that pipeline to hit an exact target total
// (e.g. 3 units at 15% VAT: the reachable totals near 12.00 are 11.99 and
// 12.01, skipping 12.00 entirely, because the subtotal's own rounding already
// commits to a value whose VAT can never land on the missing cent). No amount
// of back-solving the unit price can close a gap that isn't about precision.
//
// This function sidesteps the gap by anchoring on the total instead: the typed
// value is trusted exactly (it's already 2dp), the subtotal is derived from it
// by simple division, and VAT is computed as the *remainder* against the fixed
// total rather than independently rounded -- so lineSubtotal + lineVat always
// equals lineTotal exactly, for any quantity or VAT rate, by construction. The
// returned `unitPrice` is purely informational (for the Price column and for
// storage/reporting); it does not need to forward-reproduce the total, because
// for this line the total/subtotal/VAT are the source of truth, not the price.
export function calculateLineFromTotal(input: LineFromTotalInput): LineTotalsFromTotal {
  const lineTotal = Math.max(0, round2(input.lineTotal));
  const lineSubtotal = round2(lineTotal / (1 + input.vatRate / 100));
  const lineVat = round2(lineTotal - lineSubtotal);
  const unitPrice = input.quantity > 0 ? round3((lineSubtotal + input.discount) / input.quantity) : 0;
  return { lineSubtotal, lineVat, lineTotal, unitPrice };
}

export interface CreditNoteLineInput {
  unitPrice: number;
  vatRate: number;
  originalQuantity: number;
  originalDiscount: number;
  creditedQuantity: number;
}

export interface CreditNoteLineTotals extends LineTotals {
  discount: number;
}

// A partial credit note line reuses the *original* line's unit price, VAT rate,
// and discount rate -- crediting the customer back exactly what they were
// actually charged per unit, rather than re-deriving pricing from a total
// (which would reintroduce the exact rounding gap calculateLineFromTotal exists
// to avoid). The discount, which was a flat per-line amount, is scaled by the
// fraction of the line being credited. The scaled `discount` is returned
// alongside the totals -- not just used internally -- so a caller persisting
// the credit note line can store a `discount` that actually reconciles with
// `lineSubtotal` (unitPrice * quantity - discount = lineSubtotal), rather than
// leaving the stored row internally inconsistent.
export function calculateCreditNoteLine(input: CreditNoteLineInput): CreditNoteLineTotals {
  const scaledDiscount =
    input.originalQuantity > 0
      ? round2(input.originalDiscount * (input.creditedQuantity / input.originalQuantity))
      : 0;
  const totals = calculateLine({
    unitPrice: input.unitPrice,
    quantity: input.creditedQuantity,
    vatRate: input.vatRate,
    discount: scaledDiscount,
  });
  return { ...totals, discount: scaledDiscount };
}
