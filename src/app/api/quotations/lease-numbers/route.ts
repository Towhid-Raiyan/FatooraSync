import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { leaseNumberBlock } from "@/lib/receipts/lease-block";

const BLOCK_SIZE = 20;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const deviceId = request.headers.get("X-Device-Id");
  if (!deviceId) {
    return NextResponse.json({ error: "X-Device-Id header is required" }, { status: 400 });
  }

  const block = await leaseNumberBlock(tenantId, deviceId, "QUOTATION", BLOCK_SIZE);
  return NextResponse.json(block, { status: 200 });
}
