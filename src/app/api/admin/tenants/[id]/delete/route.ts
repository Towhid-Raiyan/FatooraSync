import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { assertCtoRole } from "@/lib/admin-auth/require-cto";
import { AUDIT_ACTIONS } from "@/lib/admin-auth/audit-actions";
import { writeAuditLog } from "@/lib/admin-auth/audit-log";
import { gatherTenantData } from "@/lib/tenant-deletion/gather-tenant-data";
import { buildTenantArchive } from "@/lib/tenant-deletion/build-archive";
import { uploadTenantArchive } from "@/lib/tenant-deletion/upload-archive";

// Strict ordering per spec S4.2: gather -> build -> upload -> verify -> write
// tombstone -> delete tenant. Each step's failure throws and stops the whole
// request before the next step runs -- there is no partial-completion state
// where some but not all of this has happened, because the tenant row (and
// everything under it) is only ever touched in the very last step, after
// everything else has already succeeded.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const forbidden = assertCtoRole(session.user.role);
  if (forbidden) return forbidden;

  const { id } = await params;

  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  // Steps a-c (gather, build, upload+verify) each throw on failure. Catching
  // here, rather than letting the error propagate, is what guarantees the
  // CTO sees a clear error instead of a bare 500 -- and it's what makes the
  // "tenant untouched on failure" guarantee (spec S4.2) observable: nothing
  // below this catch ever runs unless every step above it already succeeded.
  let archiveUrl: string;
  let summary: Awaited<ReturnType<typeof gatherTenantData>>["summary"];
  try {
    const data = await gatherTenantData(id);
    summary = data.summary;
    const archiveBuffer = await buildTenantArchive(data);
    const uploaded = await uploadTenantArchive(id, archiveBuffer);
    archiveUrl = uploaded.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: `Could not export tenant data: ${message}` }, { status: 500 });
  }

  // The tombstone write and the tenant delete must succeed or fail together --
  // otherwise a transient failure on the delete after the archive already
  // exists would leave an inconsistent state (an archive claiming the tenant
  // was deleted while the live tenant and its data still exist), and since
  // TenantArchive.originalTenantId has no uniqueness constraint, a retry
  // would create a second archive row for the same tenant. Same pattern as
  // src/app/api/admin/tenants/[id]/route.ts's own two-write transaction.
  const [archive] = await prisma.$transaction([
    prisma.tenantArchive.create({
      data: {
        originalTenantId: id,
        legalName: tenant.legalName,
        tradeNameEn: tenant.tradeNameEn,
        tradeNameAr: tenant.tradeNameAr,
        vatNumber: tenant.vatNumber,
        crNumber: tenant.crNumber,
        phone: tenant.phone,
        address: tenant.address,
        joinedAt: tenant.createdAt,
        deletedByAgencyStaffId: session.user.agencyStaffId,
        receiptCount: summary.receiptCount,
        quotationCount: summary.quotationCount,
        earliestDocumentAt: summary.earliestDocumentAt,
        latestDocumentAt: summary.latestDocumentAt,
        archiveUrl,
      },
    }),
    prisma.tenant.delete({ where: { id } }),
  ]);

  await writeAuditLog({
    agencyStaffId: session.user.agencyStaffId,
    action: AUDIT_ACTIONS.TENANT_DELETED,
    metadata: { tradeNameEn: tenant.tradeNameEn, archiveId: archive.id },
  });

  return NextResponse.json({ archiveId: archive.id });
}
