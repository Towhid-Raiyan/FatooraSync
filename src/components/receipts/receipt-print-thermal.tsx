import type { Customer, Tenant, Document as PrismaDocument } from "@prisma/client";
import { formatRiyadhDateTime } from "@/lib/format-datetime";
import { PrintButton } from "./print-button";

function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

interface PrintableLine {
  id: string;
  productName: string;
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  discount: { toString(): string };
  lineVat: { toString(): string };
  lineTotal: { toString(): string };
}

type ReceiptDocument = Omit<PrismaDocument, "subtotal" | "vatTotal" | "grandTotal"> & {
  subtotal: { toString(): string };
  vatTotal: { toString(): string };
  grandTotal: { toString(): string };
  customer: Customer;
  lines: PrintableLine[];
};

export function ReceiptPrintThermal({
  tenant,
  document,
  qrImageDataUrl,
  showPrintButton = true,
}: {
  tenant: Tenant;
  document: ReceiptDocument;
  qrImageDataUrl: string | null;
  showPrintButton?: boolean;
}) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);

  return (
    <div id="print-target" className="mx-auto max-w-[420px] bg-white p-6 text-sm text-black print:p-0 font-sans" dir="ltr">
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
        <span>{formatRiyadhDateTime(document.createdAt)}</span>
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

      {qrImageDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrImageDataUrl} alt="ZATCA QR code" className="mx-auto mt-4 h-32 w-32" />
      )}

      {showPrintButton && <PrintButton />}
    </div>
  );
}
