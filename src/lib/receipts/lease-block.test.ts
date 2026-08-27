import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { leaseNumberBlock } from "./lease-block";

let tenantId: string;

describe("leaseNumberBlock", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Lease Test Co", tradeNameEn: "Lease Test Shop", vatNumber: "300000000000123" },
    });
    tenantId = tenant.id;
  }, 30000);

  afterAll(async () => {
    await prisma.numberLease.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("reserves a contiguous block starting from the tenant's current counter", { timeout: 30000 }, async () => {
    const block = await leaseNumberBlock(tenantId, "device-a", "SALES_RECEIPT", 20);
    expect(block).toEqual({ rangeStart: 1, rangeEnd: 20 });

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.nextSalesReceiptNumber).toBe(21);
  });

  it("never overlaps a second lease, even for a different device", { timeout: 30000 }, async () => {
    const first = await leaseNumberBlock(tenantId, "device-a", "QUOTATION", 20);
    const second = await leaseNumberBlock(tenantId, "device-b", "QUOTATION", 20);
    expect(second.rangeStart).toBe(first.rangeEnd + 1);
  });

  it("keeps SALES_RECEIPT and QUOTATION counters independent", { timeout: 30000 }, async () => {
    const receiptBlock = await leaseNumberBlock(tenantId, "device-c", "SALES_RECEIPT", 5);
    const quotationBlock = await leaseNumberBlock(tenantId, "device-c", "QUOTATION", 5);
    // Independent counters -- no reason for these ranges to be related, just
    // confirming both succeed and persist as separate NumberLease rows.
    const leases = await prisma.numberLease.findMany({ where: { tenantId, deviceId: "device-c" } });
    expect(leases).toHaveLength(2);
    expect(leases.find((l) => l.documentType === "SALES_RECEIPT")?.rangeStart).toBe(receiptBlock.rangeStart);
    expect(leases.find((l) => l.documentType === "QUOTATION")?.rangeStart).toBe(quotationBlock.rangeStart);
  });
});
