import { describe, it, expect } from "vitest";
import { paginateA4Items } from "./paginate-a4-items";

describe("paginateA4Items", () => {
  it("returns a single page with 0 items", () => {
    expect(paginateA4Items(0)).toEqual([0]);
  });

  it("fits everything on one page at the single-page max (12)", () => {
    expect(paginateA4Items(12)).toEqual([12]);
  });

  it("goes multi-page one item over the single-page max, with an empty second page for totals", () => {
    expect(paginateA4Items(13)).toEqual([13, 0]);
  });

  it("fills page 1 up to its multi-page max (17) with nothing left over", () => {
    expect(paginateA4Items(17)).toEqual([17, 0]);
  });

  it("spills one item onto page 2 just past the first-page max", () => {
    expect(paginateA4Items(18)).toEqual([17, 1]);
  });

  it("fits exactly two pages at the first+last page capacity boundary (17 + 15 = 32)", () => {
    expect(paginateA4Items(32)).toEqual([17, 15]);
  });

  it("needs a third page one item past the two-page capacity boundary", () => {
    expect(paginateA4Items(33)).toEqual([17, 16, 0]);
  });

  it("splits a large order across a first, middle, and last page", () => {
    expect(paginateA4Items(52)).toEqual([17, 20, 15]);
  });

  it("every page's item count sums back to the original item count", () => {
    for (const count of [1, 12, 13, 17, 18, 31, 32, 33, 52, 60, 100]) {
      const pages = paginateA4Items(count);
      expect(pages.reduce((a, b) => a + b, 0)).toBe(count);
    }
  });
});
