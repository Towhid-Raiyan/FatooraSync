import { describe, it, expect } from "vitest";
import { round2, round3, calculateLine, calculateDocumentTotals, calculateLineFromTotal } from "./calculate-totals";

describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    expect(round2(10.005)).toBe(10.01);
    expect(round2(10.004)).toBe(10);
    expect(round2(10)).toBe(10);
  });
});

describe("round3", () => {
  it("rounds to 3 decimal places", () => {
    expect(round3(10.0005)).toBe(10.001);
    expect(round3(10.0004)).toBe(10);
    expect(round3(10)).toBe(10);
  });
});

describe("calculateLine", () => {
  it("computes subtotal, VAT, and total for a standard 15% line with no discount", () => {
    const result = calculateLine({ unitPrice: 10, quantity: 2, vatRate: 15, discount: 0 });
    expect(result).toEqual({ lineSubtotal: 20, lineVat: 3, lineTotal: 23 });
  });

  it("computes a zero-VAT (exempt) line correctly", () => {
    const result = calculateLine({ unitPrice: 10, quantity: 3, vatRate: 0, discount: 0 });
    expect(result).toEqual({ lineSubtotal: 30, lineVat: 0, lineTotal: 30 });
  });

  it("rounds a line with a fractional quantity and price", () => {
    const result = calculateLine({ unitPrice: 4.99, quantity: 3, vatRate: 15, discount: 0 });
    // subtotal = 14.97, vat = 14.97 * 0.15 = 2.2455 -> rounds to 2.25
    expect(result).toEqual({ lineSubtotal: 14.97, lineVat: 2.25, lineTotal: 17.22 });
  });

  it("applies a flat discount before computing VAT", () => {
    const result = calculateLine({ unitPrice: 10, quantity: 2, vatRate: 15, discount: 5 });
    // raw subtotal 20, discount 5 -> discounted subtotal 15, vat = 15 * 0.15 = 2.25
    expect(result).toEqual({ lineSubtotal: 15, lineVat: 2.25, lineTotal: 17.25 });
  });

  it("applies a discount that exactly zeroes out the line", () => {
    const result = calculateLine({ unitPrice: 10, quantity: 1, vatRate: 15, discount: 10 });
    expect(result).toEqual({ lineSubtotal: 0, lineVat: 0, lineTotal: 0 });
  });
});

describe("calculateDocumentTotals", () => {
  it("sums already-rounded line values rather than recomputing from an aggregate", () => {
    const lines = [
      calculateLine({ unitPrice: 10, quantity: 1, vatRate: 15, discount: 0 }), // 10 / 1.5 / 11.5
      calculateLine({ unitPrice: 4.99, quantity: 3, vatRate: 15, discount: 0 }), // 14.97 / 2.25 / 17.22
    ];
    const totals = calculateDocumentTotals(lines);
    expect(totals).toEqual({ subtotal: 24.97, vatTotal: 3.75, grandTotal: 28.72 });
  });

  it("returns all zeros for an empty line list", () => {
    expect(calculateDocumentTotals([])).toEqual({ subtotal: 0, vatTotal: 0, grandTotal: 0 });
  });
});

describe("calculateLineFromTotal", () => {
  it("reproduces the client-reported bug case exactly: 3 units, 15% VAT, target 12.00", () => {
    // The reported bug: calculateLine's chained rounding (raw subtotal rounded,
    // then VAT rounded from that already-rounded subtotal) has a genuine gap at
    // this quantity/rate -- no unit price, at any precision, forward-computes to
    // exactly 12.00 through that pipeline (the nearest reachable totals are 11.99
    // and 12.01). calculateLineFromTotal sidesteps the gap entirely by treating
    // the typed total as the fixed anchor instead of something to reconstruct.
    const result = calculateLineFromTotal({ lineTotal: 12, quantity: 3, discount: 0, vatRate: 15 });
    expect(result.lineTotal).toBe(12);
    expect(result.lineSubtotal).toBe(10.43);
    expect(result.lineVat).toBe(1.57);
    expect(round2(result.lineSubtotal + result.lineVat)).toBe(12);
  });

  it("is exact for every quantity/total combination that defeated the old back-solve approach", () => {
    // Same sweep the old deriveUnitPriceFromTotal test used to document as
    // "not always exact" -- this function must be exact for all of them, by
    // construction, since it never rounds a subtotal and then multiplies back up.
    for (const quantity of [3, 5, 6, 7]) {
      for (const lineTotal of [100, 75, 50, 33, 25, 12]) {
        const result = calculateLineFromTotal({ lineTotal, quantity, discount: 0, vatRate: 15 });
        expect(result.lineTotal).toBe(lineTotal);
        expect(round2(result.lineSubtotal + result.lineVat)).toBe(lineTotal);
      }
    }
  });

  it("matches calculateLine's plain-division result when the target is exactly achievable", () => {
    // qty 4, price 25.00 -> subtotal 100, vat 15, total 115 -- no rounding drift
    // possible either direction, so both formulas must agree.
    const forward = calculateLine({ unitPrice: 25, quantity: 4, vatRate: 15, discount: 0 });
    const fromTotal = calculateLineFromTotal({ lineTotal: 115, quantity: 4, discount: 0, vatRate: 15 });
    expect(fromTotal.lineSubtotal).toBe(forward.lineSubtotal);
    expect(fromTotal.lineVat).toBe(forward.lineVat);
    expect(fromTotal.lineTotal).toBe(115);
    expect(fromTotal.unitPrice).toBe(25);
  });

  it("accounts for a flat discount when deriving the informational unit price", () => {
    // target total 51.75, qty 2, discount 5, vat 15% -> subtotal 45, vat 6.75,
    // raw (pre-discount) subtotal 50, unit price 25
    const result = calculateLineFromTotal({ lineTotal: 51.75, quantity: 2, discount: 5, vatRate: 15 });
    expect(result.lineSubtotal).toBe(45);
    expect(result.lineVat).toBe(6.75);
    expect(result.lineTotal).toBe(51.75);
    expect(result.unitPrice).toBe(25);
  });

  it("handles a zero-VAT (exempt) line", () => {
    const result = calculateLineFromTotal({ lineTotal: 30, quantity: 3, discount: 0, vatRate: 0 });
    expect(result).toEqual({ lineSubtotal: 30, lineVat: 0, lineTotal: 30, unitPrice: 10 });
  });

  it("returns a zero unit price for a zero or negative quantity rather than dividing by it", () => {
    const result = calculateLineFromTotal({ lineTotal: 100, quantity: 0, discount: 0, vatRate: 15 });
    expect(result.unitPrice).toBe(0);
    // lineSubtotal/lineVat are still well-defined at qty 0 -- only unitPrice, a
    // per-unit derivation, is meaningless and floored instead of divided by zero.
    expect(round2(result.lineSubtotal + result.lineVat)).toBe(100);
  });

  it("floors at zero instead of returning a negative subtotal for a negative target total", () => {
    // Not something a validated caller should ever pass, but the pure function
    // still shouldn't hand back negative money for one.
    const result = calculateLineFromTotal({ lineTotal: -10, quantity: 1, discount: 0, vatRate: 15 });
    expect(result.lineTotal).toBe(0);
    expect(result.lineSubtotal).toBe(0);
    expect(result.lineVat).toBe(0);
    expect(result.unitPrice).toBe(0);
  });
});
