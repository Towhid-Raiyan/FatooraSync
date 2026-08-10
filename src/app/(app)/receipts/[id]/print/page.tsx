import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export default async function ReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const document = await withTenant(tenantId, (tx) =>
    tx.document.findFirst({
      where: { id, type: "SALES_RECEIPT" },
      include: { lines: true, customer: true },
    })
  );
  if (!document) {
    notFound();
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const qrImageDataUrl = document.qrCode ? await QRCode.toDataURL(document.qrCode) : null;

  return (
    <div className="mx-auto max-w-[420px] bg-white p-6 text-sm text-black print:p-0" dir="rtl">
      <div className="mb-4 text-center">
        <div className="text-lg font-bold">{tenant.tradeNameAr ?? tenant.tradeNameEn}</div>
        <div className="text-base">{tenant.tradeNameEn}</div>
        <div className="mt-1 text-xs">
          {tenant.legalName} — VAT {tenant.vatNumber}
        </div>
        {tenant.address && <div className="text-xs">{tenant.address}</div>}
      </div>

      <div className="mb-3 flex justify-between text-xs">
        <span>
          فاتورة ضريبية مبسطة / Simplified Tax Invoice #{document.number}
        </span>
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
            <th className="py-1 text-right">VAT</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {document.lines.map((line) => (
            <tr key={line.id} className="border-b border-gray-300">
              <td className="py-1">{line.productName}</td>
              <td className="py-1 text-right">{line.quantity.toString()}</td>
              <td className="py-1 text-right">{line.unitPrice.toString()}</td>
              <td className="py-1 text-right">{line.lineVat.toString()}</td>
              <td className="py-1 text-right">{line.lineTotal.toString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span>الإجمالي الفرعي / Subtotal</span>
          <span>{document.subtotal.toString()}</span>
        </div>
        <div className="flex justify-between">
          <span>ضريبة القيمة المضافة / VAT Total</span>
          <span>{document.vatTotal.toString()}</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>الإجمالي / Grand Total</span>
          <span>{document.grandTotal.toString()}</span>
        </div>
      </div>

      {document.notes && <div className="mt-3 text-xs">Notes: {document.notes}</div>}

      {qrImageDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrImageDataUrl} alt="ZATCA QR code" className="mx-auto mt-4 h-32 w-32" />
      )}

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
