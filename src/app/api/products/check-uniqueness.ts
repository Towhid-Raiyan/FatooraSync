import type { TenantClient } from "@/lib/db/tenant-context";

// SKU is system-generated (see generate-sku.ts) and can never collide by
// construction, so this only ever needs to guard barcode, the one field a
// user can still enter.
export async function findBarcodeConflict(
  tx: TenantClient,
  barcode: string | null | undefined,
  excludeId?: string
): Promise<boolean> {
  if (!barcode) return false;
  const existing = await tx.product.findFirst({
    where: { barcode, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return existing !== null;
}
