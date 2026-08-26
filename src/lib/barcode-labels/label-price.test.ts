import { describe, it, expect } from "vitest";
import { calculateLabelPrice } from "./label-price";

describe("calculateLabelPrice", () => {
  it("applies the tenant's default VAT rate when the product has no override", () => {
    expect(calculateLabelPrice(10, null, 15)).toBe(11.5);
  });

  it("applies the product's own VAT override instead of the tenant default", () => {
    expect(calculateLabelPrice(10, 0, 15)).toBe(10);
    expect(calculateLabelPrice(10, 5, 15)).toBe(10.5);
  });

  it("rounds to 2 decimal places", () => {
    expect(calculateLabelPrice(5.55, 15, 15)).toBe(6.38);
  });

  it("matches the reference label: 10.00 at 15% VAT is 11.50", () => {
    expect(calculateLabelPrice(10, 15, 15)).toBe(11.5);
  });
});
