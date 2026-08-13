import { describe, it, expect } from "vitest";
import { en } from "./en";
import { ar } from "./ar";

function collectKeyPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null || typeof obj === "function") {
    return [prefix];
  }
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") return [path];
    if (typeof value === "object" && value !== null) return collectKeyPaths(value, path);
    return [path];
  });
}

describe("dictionary parity", () => {
  it("en and ar expose exactly the same key paths", () => {
    const enKeys = collectKeyPaths(en).sort();
    const arKeys = collectKeyPaths(ar).sort();
    expect(arKeys).toEqual(enKeys);
  });

  it("no dictionary value is an empty string", () => {
    for (const [dictName, dict] of [["en", en], ["ar", ar]] as const) {
      for (const path of collectKeyPaths(dict)) {
        const value = path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], dict);
        if (typeof value === "string") {
          expect(value.length, `${dictName}.${path} should not be empty`).toBeGreaterThan(0);
        }
      }
    }
  });
});
