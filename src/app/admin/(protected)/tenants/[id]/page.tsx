import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { StatusPill } from "@/components/admin/status-pill";
import { TenantBillingForm } from "@/components/admin/tenant-billing-form";
import { TenantDeleteSection } from "@/components/admin/tenant-delete-section";
import { TenantInfoForm } from "@/components/admin/tenant-info-form";

export default async function AdminTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      legalName: true,
      tradeNameEn: true,
      tradeNameAr: true,
      vatNumber: true,
      crNumber: true,
      phone: true,
      address: true,
      billingStatus: true,
      trialEndsAt: true,
      featureFlags: true,
      createdAt: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
      documents: { select: { type: true, createdAt: true } },
      customers: { select: { id: true } },
      products: { select: { id: true } },
    },
  });

  if (!tenant) notFound();

  const receiptCount = tenant.documents.filter((d) => d.type === "SALES_RECEIPT").length;
  const quotationCount = tenant.documents.filter((d) => d.type === "QUOTATION").length;
  const latestDocumentAt = tenant.documents.length
    ? tenant.documents.reduce((latest, d) => (d.createdAt > latest ? d.createdAt : latest), tenant.documents[0].createdAt)
    : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-7 sm:py-8">
      <Link
        href="/admin/tenants"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-500 hover:text-green-800"
      >
        ← Back to Clients
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-bold text-neutral-900">{tenant.tradeNameEn}</h1>
        <StatusPill status={tenant.billingStatus} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.4fr]">
        <TenantInfoForm
          tenantId={tenant.id}
          initial={{
            legalName: tenant.legalName,
            tradeNameEn: tenant.tradeNameEn,
            tradeNameAr: tenant.tradeNameAr,
            vatNumber: tenant.vatNumber,
            crNumber: tenant.crNumber,
            phone: tenant.phone,
            address: tenant.address,
            createdAt: tenant.createdAt.toISOString(),
            ownerEmail: tenant.users[0]?.email ?? "",
          }}
        />

        <TenantBillingForm
          tenantId={tenant.id}
          initialStatus={tenant.billingStatus}
          initialTrialEndsAt={tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null}
          initialFeatureFlags={tenant.featureFlags}
        />
      </div>

      <div className="mt-6">
        <TenantDeleteSection
          tenantId={tenant.id}
          summary={{
            tradeNameEn: tenant.tradeNameEn,
            receiptCount,
            quotationCount,
            customerCount: tenant.customers.length,
            productCount: tenant.products.length,
            latestDocumentAt: latestDocumentAt ? latestDocumentAt.toISOString() : null,
          }}
        />
      </div>
    </div>
  );
}
