import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";

export default async function DeletedTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const archive = await prisma.tenantArchive.findUnique({
    where: { id },
    include: { deletedByAgencyStaff: { select: { email: true } } },
  });

  if (!archive) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-7 sm:py-8">
      <Link
        href="/admin/tenants/deleted"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-500 hover:text-green-800"
      >
        ← Back to Deleted Clients
      </Link>

      <h1 className="mb-1 text-xl font-bold text-neutral-900">{archive.tradeNameEn}</h1>
      <p className="mb-6 text-sm text-neutral-500">{archive.legalName}</p>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">VAT Number</div>
          <div className="font-mono text-neutral-900">{archive.vatNumber}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">CR Number</div>
          <div className="text-neutral-900">{archive.crNumber ?? "—"}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Joined</div>
          <div className="text-neutral-900">{archive.joinedAt.toLocaleDateString()}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Deleted</div>
          <div className="text-neutral-900">{archive.deletedAt.toLocaleDateString()}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Deleted By</div>
          <div className="text-neutral-900">{archive.deletedByAgencyStaff.email}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Records</div>
          <div className="text-neutral-900">
            {archive.receiptCount} receipts, {archive.quotationCount} quotations
          </div>
        </div>
      </div>

      <a
        href={`/api/admin/tenants/archived/${archive.id}/download`}
        className="mt-6 inline-flex items-center rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700"
      >
        Download Full Archive
      </a>
    </div>
  );
}
