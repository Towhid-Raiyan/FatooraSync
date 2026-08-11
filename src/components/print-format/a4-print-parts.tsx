import type { Customer, DocumentLine, Tenant, Document as PrismaDocument } from "@prisma/client";
import { truncateNote } from "@/lib/print-format/truncate-note";

export function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

export type A4Document = PrismaDocument & { customer: Customer; lines: DocumentLine[] };

export function A4BusinessHeader({
  tenant,
  document,
  docTitle,
  docNumberLabel,
  prataClassName,
}: {
  tenant: Tenant;
  document: A4Document;
  docTitle: string;
  docNumberLabel: string;
  prataClassName: string;
}) {
  return (
    <div className="flex justify-between">
      <div>
        <div className="text-[13px] font-bold">{tenant.tradeNameAr ?? tenant.tradeNameEn}</div>
        <div className="text-[11px] font-bold">{tenant.tradeNameEn}</div>
        <div className="mt-1 text-[8px] text-gray-600">VAT ID: {tenant.vatNumber}</div>
        {tenant.crNumber && <div className="text-[8px] text-gray-600">CR No: {tenant.crNumber}</div>}
        {tenant.phone && <div className="text-[8px] text-gray-600">Phone: {tenant.phone}</div>}
        {tenant.address && <div className="text-[8px] text-gray-600">{tenant.address}</div>}
      </div>
      <div className="text-right">
        <div className={`${prataClassName} text-[28px]`}>{docTitle}</div>
        <div className="mt-1 text-[8px] text-gray-600">
          {docNumberLabel} No. {document.number}
        </div>
        <div className="text-[8px] text-gray-600">{document.createdAt.toISOString().slice(0, 19).replace("T", " ")}</div>
      </div>
    </div>
  );
}

export function A4BilledTo({ customer }: { customer: Customer }) {
  return (
    <div>
      <div className="mb-1.5 text-[9px] font-bold">BILLED TO / إلى</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[8px]">
        <div>
          <span className="text-gray-500">Name</span>
          <br />
          {customer.name}
        </div>
        {customer.vatId && (
          <div>
            <span className="text-gray-500">VAT ID</span>
            <br />
            {customer.vatId}
          </div>
        )}
        {customer.crNumber && (
          <div>
            <span className="text-gray-500">CR Number</span>
            <br />
            {customer.crNumber}
          </div>
        )}
        {customer.phone && (
          <div>
            <span className="text-gray-500">Phone</span>
            <br />
            {customer.phone}
          </div>
        )}
        {customer.address && (
          <div className="col-span-2">
            <span className="text-gray-500">Address</span>
            <br />
            {customer.address}
          </div>
        )}
      </div>
    </div>
  );
}

export function A4ItemsTable({
  lines,
  startIndex,
  hasDiscount,
}: {
  lines: DocumentLine[];
  startIndex: number;
  hasDiscount: boolean;
}) {
  return (
    <table className="mt-3 w-full text-[8px]">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="py-1 text-[7px] uppercase text-gray-500">#</th>
          <th className="py-1 text-[7px] uppercase text-gray-500">Item</th>
          <th className="py-1 text-right text-[7px] uppercase text-gray-500">Qty</th>
          <th className="py-1 text-right text-[7px] uppercase text-gray-500">Price</th>
          {hasDiscount && <th className="py-1 text-right text-[7px] uppercase text-gray-500">Discount</th>}
          <th className="py-1 text-right text-[7px] uppercase text-gray-500">VAT</th>
          <th className="py-1 text-right text-[7px] uppercase text-gray-500">Total</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => (
          <tr key={line.id} className="border-b border-[#e8e5db]">
            <td className="py-1">{startIndex + i + 1}</td>
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
  );
}

export function A4Totals({ document }: { document: A4Document }) {
  return (
    <div className="absolute text-[8px]" style={{ bottom: "32mm", right: "20mm", width: "60mm" }}>
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{money(document.subtotal)} SAR</span>
      </div>
      <div className="flex justify-between">
        <span>Total VAT</span>
        <span>{money(document.vatTotal)} SAR</span>
      </div>
      <div className="mt-1 flex justify-between border-t border-black pt-1 text-[11px] font-bold">
        <span>Total Payable</span>
        <span>{money(document.grandTotal)} SAR</span>
      </div>
    </div>
  );
}

export function A4Note({ notes }: { notes: string }) {
  return (
    <div
      className="absolute rounded bg-[#eae7dd] p-2 text-[7.5px] leading-snug"
      style={{ bottom: "14mm", left: "20mm", right: "20mm" }}
    >
      Note: {truncateNote(notes)}
    </div>
  );
}

export function A4Footer() {
  return (
    <div className="absolute text-center text-[6.5px] text-gray-400" style={{ bottom: "8mm", left: 0, right: 0 }}>
      Powered By: FatooraSync
    </div>
  );
}
