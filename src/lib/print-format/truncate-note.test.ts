import { describe, it, expect } from "vitest";
import { truncateNote } from "./truncate-note";

describe("truncateNote", () => {
  it("returns short notes unchanged", () => {
    expect(truncateNote("Valid for 7 days.")).toBe("Valid for 7 days.");
  });

  it("returns a note exactly at the limit unchanged", () => {
    const exact = "a".repeat(220);
    expect(truncateNote(exact)).toBe(exact);
  });

  it("truncates a note past the limit and appends an ellipsis", () => {
    const long = "a".repeat(250);
    const result = truncateNote(long);
    expect(result.length).toBe(221); // 220 chars + "…"
    expect(result.endsWith("…")).toBe(true);
  });

  it("trims trailing whitespace before appending the ellipsis", () => {
    const long = "a".repeat(219) + "   more text that gets cut off";
    const result = truncateNote(long);
    expect(result.endsWith(" …")).toBe(false);
  });
});
