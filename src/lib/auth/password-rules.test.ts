import { describe, it, expect } from "vitest";
import { isPasswordValid, PASSWORD_RULES } from "./password-rules";

describe("isPasswordValid", () => {
  it("rejects a password shorter than 8 characters", () => {
    expect(isPasswordValid("Ab1!xyz")).toBe(false);
  });

  it("rejects a password with no uppercase letter", () => {
    expect(isPasswordValid("abcdefg1!")).toBe(false);
  });

  it("rejects a password with no number", () => {
    expect(isPasswordValid("Abcdefgh!")).toBe(false);
  });

  it("rejects a password with no special character", () => {
    expect(isPasswordValid("Abcdefg1")).toBe(false);
  });

  it("accepts a password meeting all four rules", () => {
    expect(isPasswordValid("Abcdefg1!")).toBe(true);
  });

  it("exposes exactly four rules, one per requirement", () => {
    expect(PASSWORD_RULES.map((r) => r.id).sort()).toEqual(["minLength", "number", "special", "uppercase"]);
  });
});
