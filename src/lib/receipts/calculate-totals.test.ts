import { describe, it, expect } from "vitest";
import { round2, calculateLine, calculateDocumentTotals, deriveUnitPriceFromTotal } from "./calculate-totals";

describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    expect(round2(10.005)).toBe(10.01);
    expect(round2(10.004)).toBe(10);
    expect(round2(10)).toBe(10);
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

describe("deriveUnitPriceFromTotal", () => {
  it("is the exact inverse of calculateLine for a round-trip with no discount", () => {
    const { lineTotal } = calculateLine({ unitPrice: 80, quantity: 1, vatRate: 15, discount: 0 });
    expect(lineTotal).toBe(92);
    const unitPrice = deriveUnitPriceFromTotal({ lineTotal: 92, quantity: 1, discount: 0, vatRate: 15 });
    expect(unitPrice).toBe(80);
  });

  it("accounts for discount and quantity together", () => {
    // target total 51.75, qty 2, discount 5, vat 15% -> subtotal 45, raw subtotal 50, unit price 25
    const unitPrice = deriveUnitPriceFromTotal({ lineTotal: 51.75, quantity: 2, discount: 5, vatRate: 15 });
    expect(unitPrice).toBe(25);
  });

  it("clamps to zero instead of returning a negative unit price", () => {
    // a negative target total isn't something a validated caller should ever pass,
    // but the pure function still shouldn't hand back a negative price for one
    const unitPrice = deriveUnitPriceFromTotal({ lineTotal: -10, quantity: 1, discount: 0, vatRate: 15 });
    expect(unitPrice).toBe(0);
  });

  it("returns zero for a zero or negative quantity rather than dividing by it", () => {
    expect(deriveUnitPriceFromTotal({ lineTotal: 100, quantity: 0, discount: 0, vatRate: 15 })).toBe(0);
  });
});
