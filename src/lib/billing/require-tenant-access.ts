import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { isAccessAllowed } from "./access-gate";

/**
 * Returns a 403 response if the tenant's billing status blocks access,
 * or null if the request should proceed. Mirrors the page-level gate in
 * (app)/layout.tsx, but for API routes -- that gate only covers page
 * rendering, so without this, a blocked tenant with a valid session
 * could still read/write data by calling the API directly.
 */
export async function assertTenantAccess(tenantId: string): Promise<NextResponse | null> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { billingStatus: true, trialEndsAt: true },
  });
  if (!isAccessAllowed(tenant.billingStatus, tenant.trialEndsAt)) {
    return NextResponse.json({ error: "Account access paused" }, { status: 403 });
  }
  return null;
}
