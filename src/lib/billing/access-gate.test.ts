import { describe, it, expect } from "vitest";
import { isAccessAllowed } from "./access-gate";

describe("isAccessAllowed", () => {
  it("allows ACTIVE regardless of trialEndsAt", () => {
    expect(isAccessAllowed("ACTIVE", null)).toBe(true);
    expect(isAccessAllowed("ACTIVE", new Date("2000-01-01"))).toBe(true);
  });

  it("allows COMPLIMENTARY regardless of trialEndsAt", () => {
    expect(isAccessAllowed("COMPLIMENTARY", null)).toBe(true);
    expect(isAccessAllowed("COMPLIMENTARY", new Date("2000-01-01"))).toBe(true);
  });

  it("blocks PAST_DUE regardless of trialEndsAt", () => {
    expect(isAccessAllowed("PAST_DUE", null)).toBe(false);
    expect(isAccessAllowed("PAST_DUE", new Date("2999-01-01"))).toBe(false);
  });

  it("blocks SUSPENDED regardless of trialEndsAt", () => {
    expect(isAccessAllowed("SUSPENDED", null)).toBe(false);
    expect(isAccessAllowed("SUSPENDED", new Date("2999-01-01"))).toBe(false);
  });

  it("allows TRIALING with no trialEndsAt set", () => {
    expect(isAccessAllowed("TRIALING", null)).toBe(true);
  });

  it("allows TRIALING when trialEndsAt is in the future", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-01-02T00:00:00Z");
    expect(isAccessAllowed("TRIALING", future, now)).toBe(true);
  });

  it("blocks TRIALING when trialEndsAt is in the past", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const past = new Date("2026-01-01T00:00:00Z");
    expect(isAccessAllowed("TRIALING", past, now)).toBe(false);
  });

  it("blocks TRIALING at the exact trialEndsAt instant", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(isAccessAllowed("TRIALING", now, now)).toBe(false);
  });

  it("uses the current time when `now` is not supplied", () => {
    expect(isAccessAllowed("TRIALING", new Date("2000-01-01"))).toBe(false);
    expect(isAccessAllowed("TRIALING", new Date("2999-01-01"))).toBe(true);
  });
});
