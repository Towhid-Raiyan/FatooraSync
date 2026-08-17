import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { StatusPill } from "@/components/admin/status-pill";
import { TenantBillingForm } from "@/components/admin/tenant-billing-form";

export default async function AdminTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      legalName: true,
      tradeNameEn: true,
      vatNumber: true,
      billingStatus: true,
      trialEndsAt: true,
      featureFlags: true,
      createdAt: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
    },
  });

  if (!tenant) notFound();

  return (
    <div className="mx-auto max-w-4xl px-7 py-8">
      <div className="mb-1 text-xs text-neutral-400">
        <Link href="/admin/tenants" className="hover:text-green-800">
          Tenants
        </Link>{" "}
        / {tenant.tradeNameEn}
      </div>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-bold text-neutral-900">{tenant.tradeNameEn}</h1>
        <StatusPill status={tenant.billingStatus} />
      </div>

      <div className="grid grid-cols-[1fr_1.4fr] gap-5">
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <p className="mb-4 text-[13px] font-bold text-neutral-900">Business info</p>
          <InfoRow label="Legal name" value={tenant.legalName} />
          <InfoRow label="VAT number" value={tenant.vatNumber} mono />
          <InfoRow label="Owner" value={tenant.users[0]?.email ?? "—"} />
          <InfoRow label="Created" value={tenant.createdAt.toLocaleDateString()} />
        </div>

        <TenantBillingForm
          tenantId={tenant.id}
          initialStatus={tenant.billingStatus}
          initialTrialEndsAt={tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null}
          initialFeatureFlags={tenant.featureFlags}
        />
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-neutral-100 py-2.5 text-[13px] last:border-0">
      <span className="text-neutral-400">{label}</span>
      <span className={`font-semibold text-neutral-900 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
