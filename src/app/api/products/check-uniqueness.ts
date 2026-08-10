import type { TenantClient } from "@/lib/db/tenant-context";

export async function findUniquenessConflict(
  tx: TenantClient,
  fields: { sku?: string | null; barcode?: string | null },
  excludeId?: string
): Promise<"sku" | "barcode" | null> {
  if (fields.sku) {
    const existing = await tx.product.findFirst({
      where: { sku: fields.sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (existing) return "sku";
  }
  if (fields.barcode) {
    const existing = await tx.product.findFirst({
      where: { barcode: fields.barcode, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (existing) return "barcode";
  }
  return null;
}
