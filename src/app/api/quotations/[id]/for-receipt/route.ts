import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

// Feeds the New Receipt page's "load from quotation" lookup: a self-contained
// snapshot of everything needed to prefill a receipt draft, distinct from
// print-data (which deliberately omits productId -- fine for rendering a
// document, useless for adding a line back into the Items table). Price,
// quantity, and discount come from the quotation's own saved line values (what
// was actually quoted), not the product's current price -- the customer
// approved that specific quote. Product name/sku/unit/current stock come from
// the live Product row instead, since a quotation's own `productName` is a
// point-in-time snapshot that can go stale (e.g. the product was renamed
// since) and DocumentLine doesn't carry sku/unit/stock at all.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const { id } = await params;

  const document = await withTenant(tenantId, (tx) =>
    tx.document.findFirst({
      where: { id, type: "QUOTATION" },
      include: { lines: true, customer: true },
    })
  );
  if (!document) {
    return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  }

  const productIds = [...new Set(document.lines.map((line) => line.productId))];
  const products = await withTenant(tenantId, (tx) =>
    tx.product.findMany({ where: { id: { in: productIds } } })
  );
  const productById = new Map(products.map((p) => [p.id, p]));

  // A referenced product can never be hard-deleted (RESTRICT foreign key from
  // DocumentLine), so this can only happen if the DB was touched outside the
  // app -- still handled explicitly rather than crashing on a missing map entry.
  const missingProduct = document.lines.some((line) => !productById.has(line.productId));
  if (missingProduct) {
    return NextResponse.json({ error: "One or more items on this quotation are no longer available" }, { status: 409 });
  }

  return NextResponse.json({
    number: document.number,
    customer: {
      name: document.customer.name,
      vatId: document.customer.vatId ?? "",
      crNumber: document.customer.crNumber ?? "",
      phone: document.customer.phone ?? "",
      address: document.customer.address ?? "",
    },
    lines: document.lines.map((line) => {
      const product = productById.get(line.productId)!;
      return {
        productId: line.productId,
        sku: product.sku,
        productName: product.nameEn,
        productNameAr: product.nameAr,
        unit: product.unit,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        discount: line.discount.toString(),
        vatRate: line.vatRate.toString(),
        stockAtAdd: product.quantity.toString(),
      };
    }),
  });
}
