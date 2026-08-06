import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";

export async function GET() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const settings = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const session = await auth();
  const tenantId = session!.user.tenantId;
  const body = await request.json();

  await withTenant(tenantId, (tx) =>
    tx.settings.update({
      where: { tenantId },
      data: { defaultVatRate: body.defaultVatRate, language: body.language },
    })
  );

  return NextResponse.json({ ok: true });
}
