import { Prisma, type Product } from "@prisma/client";
import type { TenantClient } from "@/lib/db/tenant-context";

// Product.barcode is optional -- many products (especially ones the business
// created itself rather than restocking a manufacturer's item) never had one
// scanned in. Rather than blocking label printing until someone fills one in
// by hand, this falls back to the product's own SKU (already unique per
// tenant, always assigned at creation -- see generate-sku.ts) as the barcode
// content, and persists it onto the product so the printed sticker is
// actually scannable at checkout afterward, not just a one-off image.
export async function resolveLabelBarcode(tx: TenantClient, product: Product): Promise<string> {
  if (product.barcode) return product.barcode;

  // sku is nullable in the schema but every creation path assigns one
  // (see src/app/api/products/generate-sku.ts) -- this is a defensive
  // fallback for a state that shouldn't occur in practice, not the expected path.
  if (!product.sku) {
    throw new Error(`Product ${product.id} has neither a barcode nor a SKU to print`);
  }

  try {
    await tx.product.update({ where: { id: product.id }, data: { barcode: product.sku } });
  } catch (err) {
    // Extremely unlikely (a SKU string colliding with an existing barcode on
    // a different product), but if it happens, the label can still print --
    // it just won't scan-match this product until someone resolves the
    // conflict by hand. Don't fail the whole print job over it.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
      throw err;
    }
  }

  return product.sku;
}
