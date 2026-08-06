import { describe, it, expect, vi, afterEach } from "vitest";
import { isRateLimited, recordFailedAttempt, resetAttempts } from "./rate-limit";

describe("rate limiting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not rate limited before any failures are recorded", () => {
    const id = "fresh-identifier@example.com";
    expect(isRateLimited(id)).toBe(false);
  });

  it("blocks after 5 recorded failures, and allows a 6th distinct identifier through", () => {
    const id = "rate-limit-test@example.com";
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(id)).toBe(false);
      recordFailedAttempt(id);
    }
    expect(isRateLimited(id)).toBe(true);

    expect(isRateLimited("someone-else@example.com")).toBe(false);
  });

  it("does not count toward the limit unless recordFailedAttempt is called (successes don't accumulate)", () => {
    const id = "never-fails@example.com";
    for (let i = 0; i < 20; i++) {
      expect(isRateLimited(id)).toBe(false);
      // Simulates a successful login: no recordFailedAttempt call.
    }
    expect(isRateLimited(id)).toBe(false);
  });

  it("resets the counter on resetAttempts, unblocking a previously rate-limited identifier", () => {
    const id = "reset-me@example.com";
    for (let i = 0; i < 5; i++) recordFailedAttempt(id);
    expect(isRateLimited(id)).toBe(true);

    resetAttempts(id);
    expect(isRateLimited(id)).toBe(false);
  });

  it("evicts attempts once they age out of the window", () => {
    vi.useFakeTimers();
    const id = "evict-me@example.com";
    try {
      for (let i = 0; i < 5; i++) recordFailedAttempt(id);
      expect(isRateLimited(id)).toBe(true);

      // Advance past the 15-minute window.
      vi.advanceTimersByTime(15 * 60 * 1000 + 1);

      expect(isRateLimited(id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
