import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { PrintButton } from "@/components/receipts/print-button";

function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

export default async function QuotationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const document = await withTenant(tenantId, (tx) =>
    tx.document.findFirst({
      where: { id, type: "QUOTATION" },
      include: { lines: true, customer: true },
    })
  );
  if (!document) {
    notFound();
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);

  return (
    <div className="mx-auto max-w-[420px] bg-white p-6 text-sm text-black print:p-0" dir="ltr">
      <div className="mb-4 text-center">
        <div className="text-lg font-bold">{tenant.tradeNameAr ?? tenant.tradeNameEn}</div>
        <div className="text-base">{tenant.tradeNameEn}</div>
        <div className="mt-1 text-xs">
          {tenant.legalName} — VAT {tenant.vatNumber}
        </div>
        {tenant.address && <div className="text-xs">{tenant.address}</div>}
      </div>

      <div className="mb-3 flex justify-between text-xs">
        <span>QUOTATION (عرض سعر) #{document.number}</span>
        <span>{document.createdAt.toISOString().slice(0, 19).replace("T", " ")}</span>
      </div>

      <div className="mb-3 border-t border-b border-black py-2 text-xs">
        <div>
          العميل / Customer: {document.customer.name}
        </div>
        {document.customer.vatId && <div>VAT ID: {document.customer.vatId}</div>}
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">المنتج / Item</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Price</th>
            {hasDiscount && <th className="py-1 text-right">Discount</th>}
            <th className="py-1 text-right">VAT</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {document.lines.map((line) => (
            <tr key={line.id} className="border-b border-gray-300">
              <td className="py-1">{line.productName}</td>
              <td className="py-1 text-right">{line.quantity.toString()}</td>
              <td className="py-1 text-right">{money(line.unitPrice)}</td>
              {hasDiscount && <td className="py-1 text-right">{money(line.discount)}</td>}
              <td className="py-1 text-right">{money(line.lineVat)}</td>
              <td className="py-1 text-right">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span>الإجمالي الفرعي / Subtotal</span>
          <span>{money(document.subtotal)} SAR</span>
        </div>
        <div className="flex justify-between">
          <span>ضريبة القيمة المضافة / VAT Total</span>
          <span>{money(document.vatTotal)} SAR</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>الإجمالي / Grand Total</span>
          <span>{money(document.grandTotal)} SAR</span>
        </div>
      </div>

      {document.notes && <div className="mt-3 text-xs">Notes: {document.notes}</div>}

      <PrintButton />

      <style>{`
        @media print {
          aside,
          [aria-hidden] { display: none !important; }
          div.border-b.border-border-subtle.backdrop-blur-sm { display: none !important; }
          .flex.h-screen { display: block !important; height: auto !important; }
          .overflow-hidden.bg-bg-app { overflow: visible !important; }
          main { padding: 0 !important; overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}
