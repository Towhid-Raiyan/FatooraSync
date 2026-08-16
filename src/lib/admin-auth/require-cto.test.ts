import { describe, it, expect } from "vitest";
import { assertCtoRole } from "./require-cto";

describe("assertCtoRole", () => {
  it("returns null for a CTO", () => {
    expect(assertCtoRole("CTO")).toBeNull();
  });

  it("returns a 403 response for a Developer", async () => {
    const response = assertCtoRole("DEVELOPER");
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it("returns a 403 response for an undefined role", async () => {
    const response = assertCtoRole(undefined);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });
});
