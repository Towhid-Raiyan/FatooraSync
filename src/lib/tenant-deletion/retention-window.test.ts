import { describe, it, expect } from "vitest";
import { isWithinRetentionWindow } from "./retention-window";

describe("isWithinRetentionWindow", () => {
  it("is true for a document created 1 year ago", () => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    expect(isWithinRetentionWindow(oneYearAgo)).toBe(true);
  });

  it("is false for a document created 7 years ago", () => {
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
    expect(isWithinRetentionWindow(sevenYearsAgo)).toBe(false);
  });

  it("is false when there is no document at all", () => {
    expect(isWithinRetentionWindow(null)).toBe(false);
  });
});
