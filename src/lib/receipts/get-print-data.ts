import QRCode from "qrcode";
import type { Customer, DocumentLine, DocumentType, Tenant, Document as PrismaDocument } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export interface DocumentPrintData {
  printFormat: "THERMAL" | "A4";
  tenant: Tenant;
  document: PrismaDocument & { customer: Customer; lines: DocumentLine[] };
  qrImageDataUrl: string | null;
}

export async function getDocumentPrintData(
  tenantId: string,
  id: string,
  type: DocumentType
): Promise<DocumentPrintData | null> {
  const [document, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.document.findFirst({
        where: { id, type },
        include: { lines: true, customer: true },
      }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );
  if (!document) return null;

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const qrImageDataUrl = document.qrCode ? await QRCode.toDataURL(document.qrCode) : null;

  return { printFormat: settings.printFormat, tenant, document, qrImageDataUrl };
}
