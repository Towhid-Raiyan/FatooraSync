import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "./password";
import { authorize } from "./config";

let tenantId: string;

describe("credentials authorize", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Auth Test Co", tradeNameEn: "Auth Test Shop", vatNumber: "300000000000004" },
    });
    tenantId = tenant.id;

    await prisma.user.create({
      data: {
        tenantId,
        email: "owner@example.com",
        passwordHash: await hashPassword("supersecret123"),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("returns the user for valid credentials", async () => {
    const user = await authorize({ email: "owner@example.com", password: "supersecret123" });
    expect(user).not.toBeNull();
    expect(user?.tenantId).toBe(tenantId);
  });

  it("returns null for an invalid password", async () => {
    const user = await authorize({ email: "owner@example.com", password: "wrong" });
    expect(user).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    const user = await authorize({ email: "nobody@example.com", password: "whatever" });
    expect(user).toBeNull();
  });

  it("returns null once the rate limit is exceeded for an identifier", async () => {
    const email = "rate-limited-login@example.com";
    for (let i = 0; i < 5; i++) {
      await authorize({ email, password: "whatever" });
    }
    const user = await authorize({ email, password: "whatever" });
    expect(user).toBeNull();
  });
});
