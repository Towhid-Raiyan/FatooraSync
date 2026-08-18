import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { AUDIT_ACTIONS } from "@/lib/admin-auth/audit-actions";
import { writeAuditLog } from "@/lib/admin-auth/audit-log";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isPasswordValid } from "@/lib/auth/password-rules";

// Self-service only - any AgencyStaff role (CTO or Developer) can change
// their own password. No CTO-only guard here, unlike the tenant-management
// routes: this endpoint never touches another account.
export async function PATCH(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!isPasswordValid(newPassword)) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters and include an uppercase letter, a number, and a special character" },
      { status: 400 }
    );
  }

  const staff = await prisma.agencyStaff.findUniqueOrThrow({ where: { id: session.user.agencyStaffId } });

  const currentPasswordValid = await verifyPassword(currentPassword, staff.passwordHash);
  if (!currentPasswordValid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }

  await prisma.agencyStaff.update({
    where: { id: staff.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  await writeAuditLog({
    agencyStaffId: staff.id,
    action: AUDIT_ACTIONS.AGENCY_STAFF_PASSWORD_CHANGED,
  });

  return NextResponse.json({ ok: true });
}
