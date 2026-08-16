import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { authorize } from "./config";

describe("admin credentials authorize", () => {
  beforeAll(async () => {
    await prisma.agencyStaff.create({
      data: {
        email: "admin-auth-config-test@fatoorasync.sa",
        passwordHash: await hashPassword("supersecret123"),
        role: "CTO",
      },
    });
  });

  afterAll(async () => {
    await prisma.agencyStaff.deleteMany({ where: { email: "admin-auth-config-test@fatoorasync.sa" } });
    await prisma.$disconnect();
  });

  it("returns the staff member for valid credentials", async () => {
    const staff = await authorize({ email: "admin-auth-config-test@fatoorasync.sa", password: "supersecret123" });
    expect(staff).not.toBeNull();
    expect(staff?.role).toBe("CTO");
  });

  it("matches email case-insensitively", async () => {
    const staff = await authorize({ email: "ADMIN-AUTH-CONFIG-TEST@FatooraSync.SA", password: "supersecret123" });
    expect(staff).not.toBeNull();
    expect(staff?.email).toBe("admin-auth-config-test@fatoorasync.sa");
  });

  it("returns null for an invalid password", async () => {
    const staff = await authorize({ email: "admin-auth-config-test@fatoorasync.sa", password: "wrong" });
    expect(staff).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    const staff = await authorize({ email: "nobody@fatoorasync.sa", password: "whatever" });
    expect(staff).toBeNull();
  });

  it("returns null once the rate limit is exceeded for an identifier", async () => {
    const email = "rate-limited-admin@fatoorasync.sa";
    for (let i = 0; i < 5; i++) {
      await authorize({ email, password: "whatever" });
    }
    const staff = await authorize({ email, password: "whatever" });
    expect(staff).toBeNull();
  });
});
