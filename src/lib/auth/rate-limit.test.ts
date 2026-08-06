import { describe, it, expect } from "vitest";
import { isRateLimited } from "./rate-limit";

describe("isRateLimited", () => {
  it("allows up to 5 attempts then blocks the 6th", () => {
    const id = "rate-limit-test@example.com";
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(id)).toBe(false);
    }
    expect(isRateLimited(id)).toBe(true);
  });

  it("tracks different identifiers independently", () => {
    expect(isRateLimited("someone-else@example.com")).toBe(false);
  });
});
