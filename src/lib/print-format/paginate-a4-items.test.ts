import { describe, it, expect } from "vitest";
import { paginateA4Items } from "./paginate-a4-items";

describe("paginateA4Items", () => {
  it("returns a single page with 0 items", () => {
    expect(paginateA4Items(0)).toEqual([0]);
  });

  it("fits everything on one page at the single-page max (14)", () => {
    expect(paginateA4Items(14)).toEqual([14]);
  });

  it("goes multi-page one item over the single-page max, with an empty second page for totals", () => {
    expect(paginateA4Items(15)).toEqual([15, 0]);
  });

  it("fills page 1 up to its multi-page max (20) with nothing left over", () => {
    expect(paginateA4Items(20)).toEqual([20, 0]);
  });

  it("spills one item onto page 2 just past the first-page max", () => {
    expect(paginateA4Items(21)).toEqual([20, 1]);
  });

  it("fits exactly two pages at the first+last page capacity boundary (20 + 16 = 36)", () => {
    expect(paginateA4Items(36)).toEqual([20, 16]);
  });

  it("needs a third page one item past the two-page capacity boundary", () => {
    expect(paginateA4Items(37)).toEqual([20, 17, 0]);
  });

  it("splits a large order across a first, middle, and last page", () => {
    expect(paginateA4Items(60)).toEqual([20, 26, 14]);
  });

  it("every page's item count sums back to the original item count", () => {
    for (const count of [1, 13, 14, 15, 20, 21, 35, 36, 37, 60, 100]) {
      const pages = paginateA4Items(count);
      expect(pages.reduce((a, b) => a + b, 0)).toBe(count);
    }
  });
});
