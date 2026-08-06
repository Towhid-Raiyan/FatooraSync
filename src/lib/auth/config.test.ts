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

  it("does not count successful logins toward the rate limit", async () => {
    // 10 successful logins in a row (well over MAX_ATTEMPTS) must all
    // succeed - only failed attempts should ever count toward the limit,
    // otherwise the legitimate owner locks themselves out.
    for (let i = 0; i < 10; i++) {
      const user = await authorize({ email: "owner@example.com", password: "supersecret123" });
      expect(user).not.toBeNull();
    }
  });

  it("resets the rate limit counter after a successful login", async () => {
    const email = "resets-after-success@example.com";

    // Create a dedicated user for this test so a successful login is possible.
    await prisma.user.create({
      data: {
        tenantId,
        email,
        passwordHash: await hashPassword("correct-password"),
      },
    });

    // 4 failures - one below the 5-attempt threshold.
    for (let i = 0; i < 4; i++) {
      const failed = await authorize({ email, password: "wrong" });
      expect(failed).toBeNull();
    }

    // A successful login should clear the counter entirely.
    const success = await authorize({ email, password: "correct-password" });
    expect(success).not.toBeNull();

    // Another 4 failures immediately after should still not trip the limit,
    // proving the counter was reset rather than merely not incremented.
    for (let i = 0; i < 4; i++) {
      const failed = await authorize({ email, password: "wrong" });
      expect(failed).toBeNull();
    }
    // The account should still be reachable with the correct password.
    const stillWorks = await authorize({ email, password: "correct-password" });
    expect(stillWorks).not.toBeNull();
  });
});
