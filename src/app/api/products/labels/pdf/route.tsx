import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { assertCanManageCatalog } from "@/lib/rbac/require-catalog-access";
import { parseLabelItemsInput, buildLabelItems, LabelBuildError } from "@/lib/barcode-labels/build-label-items";
import { LabelPdfDocument } from "@/lib/barcode-labels/label-pdf";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const catalogBlocked = await assertCanManageCatalog(tenantId, session.user.role);
  if (catalogBlocked) return catalogBlocked;

  try {
    const items = parseLabelItemsInput(await request.json());

    const [tenant, result] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { tradeNameEn: true } }),
      withTenant(tenantId, async (tx) => {
        const settings = await tx.settings.findUniqueOrThrow({ where: { tenantId } });
        const labelItems = await buildLabelItems(tx, settings, items);
        return { labelWidthMm: settings.labelWidthMm, labelHeightMm: settings.labelHeightMm, labelItems };
      }),
    ]);

    const buffer = await renderToBuffer(
      <LabelPdfDocument
        tenantTradeName={tenant.tradeNameEn}
        items={result.labelItems}
        labelWidthMm={result.labelWidthMm}
        labelHeightMm={result.labelHeightMm}
      />
    );

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="barcode-labels.pdf"`,
      },
    });
  } catch (err) {
    if (err instanceof LabelBuildError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
