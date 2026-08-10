import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { ReceiptForm } from "@/components/receipts/receipt-form";

export default async function NewReceiptPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [customers, products, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      tx.product.findMany({ where: { isActive: true }, orderBy: { nameEn: "asc" } }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );

  // Decimal fields can't cross the Server -> Client Component boundary as raw
  // Prisma Decimal instances -- convert to strings first (same reasoning as the
  // Products page).
  const serializedProducts = products.map((p) => ({
    ...p,
    unitPrice: p.unitPrice.toString(),
    vatRate: p.vatRate?.toString() ?? null,
    quantity: p.quantity.toString(),
  }));

  return (
    <ReceiptForm
      initialCustomers={customers}
      initialProducts={serializedProducts}
      defaultVatRate={settings.defaultVatRate.toString()}
    />
  );
}
