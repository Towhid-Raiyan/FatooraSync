import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { PATCH } from "./route";

let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

let staffId: string;

describe("/api/admin/account/password", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const staff = await prisma.agencyStaff.create({
      data: {
        email: `account-password-route+${uniqueId}@fatoorasync.sa`,
        passwordHash: await hashPassword("OriginalPass1!"),
        role: "DEVELOPER",
      },
    });
    staffId = staff.id;
    mockSession = { user: { agencyStaffId: staffId, role: "DEVELOPER" } };
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyStaffId: staffId } });
    await prisma.agencyStaff.delete({ where: { id: staffId } });
    await prisma.$disconnect();
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await PATCH(
        new Request("http://localhost", {
          method: "PATCH",
          body: JSON.stringify({ currentPassword: "OriginalPass1!", newPassword: "NewPass123!" }),
        })
      );
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: staffId, role: "DEVELOPER" } };
    }
  });

  it("rejects a new password that doesn't meet the requirements", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword: "OriginalPass1!", newPassword: "weak" }),
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/requirements|characters/i);
  });

  it("rejects an incorrect current password", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword: "WrongPassword1!", newPassword: "NewPass123!" }),
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/current password/i);

    const staff = await prisma.agencyStaff.findUniqueOrThrow({ where: { id: staffId } });
    expect(await verifyPassword("OriginalPass1!", staff.passwordHash)).toBe(true);
  });

  it("updates the password and writes an audit log entry when the current password is correct", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword: "OriginalPass1!", newPassword: "NewPass123!" }),
      })
    );
    expect(response.status).toBe(200);

    const staff = await prisma.agencyStaff.findUniqueOrThrow({ where: { id: staffId } });
    expect(await verifyPassword("NewPass123!", staff.passwordHash)).toBe(true);
    expect(await verifyPassword("OriginalPass1!", staff.passwordHash)).toBe(false);

    const auditRows = await prisma.auditLog.findMany({
      where: { agencyStaffId: staffId, action: "AGENCY_STAFF_PASSWORD_CHANGED" },
    });
    expect(auditRows).toHaveLength(1);
  });
});
