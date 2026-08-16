import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { assertCtoRole } from "@/lib/admin-auth/require-cto";
import { AUDIT_ACTIONS } from "@/lib/admin-auth/audit-actions";
import { writeAuditLog } from "@/lib/admin-auth/audit-log";

const VALID_STATUSES = ["TRIALING", "ACTIVE", "COMPLIMENTARY", "PAST_DUE", "SUSPENDED"];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const forbidden = assertCtoRole(session.user.role);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = await request.json();

  if (typeof body.billingStatus !== "string" || !VALID_STATUSES.includes(body.billingStatus)) {
    return NextResponse.json({ error: `billingStatus must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const existing = await prisma.tenant.findUnique({ where: { id }, select: { billingStatus: true } });
  if (!existing) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const tenant = await prisma.tenant.update({
    where: { id },
    data: {
      billingStatus: body.billingStatus,
      trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : null,
      featureFlags: body.featureFlags ?? {},
    },
    select: { id: true, billingStatus: true, trialEndsAt: true, featureFlags: true },
  });

  await writeAuditLog({
    agencyStaffId: session.user.agencyStaffId,
    action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
    tenantId: id,
    metadata: { from: existing.billingStatus, to: tenant.billingStatus },
  });

  return NextResponse.json(tenant);
}
