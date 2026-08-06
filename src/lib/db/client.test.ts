import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./client";

describe("prisma client", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("can create and read a tenant", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        legalName: "Test Trading Co",
        tradeNameEn: "Test Shop",
        vatNumber: "300000000000003",
      },
    });

    const found = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(found.tradeNameEn).toBe("Test Shop");

    await prisma.tenant.delete({ where: { id: tenant.id } });
  });
});
