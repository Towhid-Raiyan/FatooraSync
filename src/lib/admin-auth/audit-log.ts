import { prisma } from "@/lib/db/client";

export async function writeAuditLog(input: {
  agencyStaffId: string;
  action: string;
  tenantId?: string;
  metadata?: object;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      agencyStaffId: input.agencyStaffId,
      action: input.action,
      tenantId: input.tenantId,
      metadata: input.metadata ?? {},
    },
  });
}
