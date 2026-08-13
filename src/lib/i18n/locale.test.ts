import { describe, it, expect } from "vitest";
import { pickLocale } from "./locale";

describe("pickLocale", () => {
  it("uses the cookie value when it's a valid locale", () => {
    expect(pickLocale("ar", "en")).toBe("ar");
    expect(pickLocale("en", "ar")).toBe("en");
  });

  it("falls back to the tenant default when there's no cookie", () => {
    expect(pickLocale(undefined, "ar")).toBe("ar");
    expect(pickLocale(null, "en")).toBe("en");
  });

  it("falls back to English when neither the cookie nor a tenant default is valid", () => {
    expect(pickLocale(undefined, undefined)).toBe("en");
    expect(pickLocale(null, null)).toBe("en");
  });

  it("ignores an invalid cookie value and falls through to the tenant default", () => {
    expect(pickLocale("fr", "ar")).toBe("ar");
  });

  it("ignores an invalid tenant default and falls through to English", () => {
    expect(pickLocale(undefined, "fr")).toBe("en");
  });
});
