import { describe, it, expect, beforeEach } from "vitest";
import { offlineDb } from "./db";
import { storeLeasedBlock, issueNumber, remainingCapacity } from "./lease-store";

describe("lease-store", () => {
  beforeEach(async () => {
    await offlineDb.numberLeases.clear();
  });

  it("issues numbers sequentially from a stored block", async () => {
    await storeLeasedBlock("SALES_RECEIPT", 5, 24);
    expect(await issueNumber("SALES_RECEIPT")).toBe(5);
    expect(await issueNumber("SALES_RECEIPT")).toBe(6);
    expect(await issueNumber("SALES_RECEIPT")).toBe(7);
  });

  it("returns null once every leased block is exhausted", async () => {
    await storeLeasedBlock("SALES_RECEIPT", 1, 1);
    expect(await issueNumber("SALES_RECEIPT")).toBe(1);
    expect(await issueNumber("SALES_RECEIPT")).toBeNull();
  });

  it("keeps SALES_RECEIPT and QUOTATION capacity independent", async () => {
    await storeLeasedBlock("SALES_RECEIPT", 1, 1);
    expect(await issueNumber("QUOTATION")).toBeNull();
    expect(await remainingCapacity("SALES_RECEIPT")).toBe(1); // untouched -- issuing QUOTATION must not consume the SALES_RECEIPT block
  });

  it("reports remaining capacity across multiple leased blocks", async () => {
    await storeLeasedBlock("SALES_RECEIPT", 1, 5);
    await storeLeasedBlock("SALES_RECEIPT", 6, 10);
    expect(await remainingCapacity("SALES_RECEIPT")).toBe(10);
    await issueNumber("SALES_RECEIPT");
    expect(await remainingCapacity("SALES_RECEIPT")).toBe(9);
  });
});
