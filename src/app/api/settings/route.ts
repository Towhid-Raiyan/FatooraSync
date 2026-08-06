import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;

  const settings = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const body = await request.json();

  const vatRate = Number(body.defaultVatRate);
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    return NextResponse.json(
      { error: "defaultVatRate must be a number between 0 and 100" },
      { status: 400 }
    );
  }

  if (body.language !== "ar" && body.language !== "en") {
    return NextResponse.json(
      { error: "language must be either \"ar\" or \"en\"" },
      { status: 400 }
    );
  }

  await withTenant(tenantId, (tx) =>
    tx.settings.update({
      where: { tenantId },
      data: { defaultVatRate: body.defaultVatRate, language: body.language },
    })
  );

  return NextResponse.json({ ok: true });
}
