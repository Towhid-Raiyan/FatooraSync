import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export interface QuotationPrintData {
  printFormat: "THERMAL" | "A4";
  tenant: Tenant;
  document: PrismaDocument & { customer: Customer; lines: DocumentLine[] };
}

export async function getQuotationPrintData(tenantId: string, id: string): Promise<QuotationPrintData | null> {
  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type: "QUOTATION" },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) return null;

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  return { printFormat: settings.printFormat, tenant, document };
}
