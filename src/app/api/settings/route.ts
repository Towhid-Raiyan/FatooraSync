import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const [settings, tenant] = await Promise.all([
    withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } })),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { phone: true } }),
  ]);

  return NextResponse.json({ ...settings, phone: tenant.phone });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
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

  if (body.printFormat !== "THERMAL" && body.printFormat !== "A4") {
    return NextResponse.json(
      { error: "printFormat must be either \"THERMAL\" or \"A4\"" },
      { status: 400 }
    );
  }

  await withTenant(tenantId, (tx) =>
    tx.settings.update({
      where: { tenantId },
      data: { defaultVatRate: body.defaultVatRate, language: body.language, printFormat: body.printFormat },
    })
  );

  // Business phone lives on Tenant (alongside legalName/tradeName/vatNumber/crNumber/
  // address), not Settings -- it's a business-profile fact, not a preference. Tenant is
  // never accessed through withTenant() (same pattern as the print/PDF routes and the
  // receipt/quotation save routes' own `tenant.findUniqueOrThrow` calls); `where: { id:
  // tenantId }` is already exactly this tenant, taken from the session rather than from
  // request input, so there's no cross-tenant risk here.
  const trimmedPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  await prisma.tenant.update({ where: { id: tenantId }, data: { phone: trimmedPhone || null } });

  return NextResponse.json({ ok: true });
}
