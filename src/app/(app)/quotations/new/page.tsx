import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { QuotationForm } from "@/components/quotations/quotation-form";

export default async function NewQuotationPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [customers, products, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      tx.product.findMany({ where: { isActive: true }, orderBy: { nameEn: "asc" } }),
      tx.settings.findUniqueOrThrow({ where: { tenantId } }),
    ])
  );

  const serializedProducts = products.map((p) => ({
    ...p,
    unitPrice: p.unitPrice.toString(),
    vatRate: p.vatRate?.toString() ?? null,
    quantity: p.quantity.toString(),
    lowStockThreshold: p.lowStockThreshold?.toString() ?? null,
  }));

  return (
    <QuotationForm
      initialCustomers={customers}
      initialProducts={serializedProducts}
      defaultVatRate={settings.defaultVatRate.toString()}
    />
  );
}
