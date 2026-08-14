import { describe, it, expect } from "vitest";
import { assertOwnerRole } from "./require-owner";

describe("assertOwnerRole", () => {
  it("returns null for an Owner", () => {
    expect(assertOwnerRole("OWNER")).toBeNull();
  });

  it("returns a 403 response for a Cashier", async () => {
    const response = assertOwnerRole("CASHIER");
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it("returns a 403 response for an undefined role", async () => {
    const response = assertOwnerRole(undefined);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });
});
