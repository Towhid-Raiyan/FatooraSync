import type { Customer, Tenant, Document as PrismaDocument } from "@prisma/client";
import { truncateNote } from "@/lib/print-format/truncate-note";

export function money(value: { toString(): string }): string {
  return Number(value.toString()).toFixed(2);
}

export interface A4PrintableLine {
  id: string;
  productName: string;
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  discount: { toString(): string };
  lineVat: { toString(): string };
  lineTotal: { toString(): string };
}

export type A4Document = Omit<PrismaDocument, "subtotal" | "vatTotal" | "grandTotal"> & {
  subtotal: { toString(): string };
  vatTotal: { toString(): string };
  grandTotal: { toString(): string };
  customer: Customer;
  lines: A4PrintableLine[];
};

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
        <div className="text-[17px] font-bold">{tenant.tradeNameAr ?? tenant.tradeNameEn}</div>
        <div className="text-[15px] font-bold">{tenant.tradeNameEn}</div>
        <div className="mt-1 text-[13px] text-gray-600">VAT ID: {tenant.vatNumber}</div>
        {tenant.crNumber && <div className="text-[13px] text-gray-600">CR No: {tenant.crNumber}</div>}
        {tenant.phone && <div className="text-[13px] text-gray-600">Phone: {tenant.phone}</div>}
        {tenant.address && <div className="text-[13px] text-gray-600">{tenant.address}</div>}
      </div>
      <div className="text-right">
        <div className={`${prataClassName} text-[32px]`}>{docTitle}</div>
        <div className="mt-1 text-[13px] text-gray-600">
          {docNumberLabel} No. {document.number}
        </div>
        <div className="text-[13px] text-gray-600">{document.createdAt.toISOString().slice(0, 19).replace("T", " ")}</div>
      </div>
    </div>
  );
}

export function A4BilledTo({ customer }: { customer: Customer }) {
  return (
    <div>
      <div className="mb-1.5 text-[14px] font-bold">BILLED TO / إلى</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        <div>
          <span className="text-[11px] text-gray-500">Name</span>
          <br />
          {customer.name}
        </div>
        {customer.vatId && (
          <div>
            <span className="text-[11px] text-gray-500">VAT ID</span>
            <br />
            {customer.vatId}
          </div>
        )}
        {customer.crNumber && (
          <div>
            <span className="text-[11px] text-gray-500">CR Number</span>
            <br />
            {customer.crNumber}
          </div>
        )}
        {customer.phone && (
          <div>
            <span className="text-[11px] text-gray-500">Phone</span>
            <br />
            {customer.phone}
          </div>
        )}
        {customer.address && (
          <div className="col-span-2">
            <span className="text-[11px] text-gray-500">Address</span>
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
  lines: A4PrintableLine[];
  startIndex: number;
  hasDiscount: boolean;
}) {
  return (
    <table className="mt-3 w-full text-[13px]">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="py-1.5 text-[11px] uppercase text-gray-500">#</th>
          <th className="py-1.5 text-[11px] uppercase text-gray-500">Item</th>
          <th className="py-1.5 text-right text-[11px] uppercase text-gray-500">Qty</th>
          <th className="py-1.5 text-right text-[11px] uppercase text-gray-500">Price</th>
          {hasDiscount && <th className="py-1.5 text-right text-[11px] uppercase text-gray-500">Discount</th>}
          <th className="py-1.5 text-right text-[11px] uppercase text-gray-500">VAT</th>
          <th className="py-1.5 text-right text-[11px] uppercase text-gray-500">Total</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => (
          <tr key={line.id} className="border-b border-[#e8e5db]">
            <td className="py-1.5">{startIndex + i + 1}</td>
            <td className="py-1.5">{line.productName}</td>
            <td className="py-1.5 text-right">{line.quantity.toString()}</td>
            <td className="py-1.5 text-right">{money(line.unitPrice)}</td>
            {hasDiscount && <td className="py-1.5 text-right">{money(line.discount)}</td>}
            <td className="py-1.5 text-right">{money(line.lineVat)}</td>
            <td className="py-1.5 text-right">{money(line.lineTotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Combines the QR code (receipt only -- callers simply don't pass `qrImageDataUrl`
// for quotations, which never have one) and the totals block into one row, right
// after the item table in normal flow -- not pinned to the page bottom, so a short
// document doesn't leave a large gap between its items and its totals, and nothing
// can silently overflow past the true printable page boundary. `justify-between`
// still pushes totals to the right even when there's no QR to anchor the left side.
export function A4TotalsRow({ document, qrImageDataUrl }: { document: A4Document; qrImageDataUrl?: string | null }) {
  return (
    <div className="mt-5 flex items-end justify-between">
      {qrImageDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrImageDataUrl} alt="ZATCA QR code" className="h-20 w-20" />
      ) : (
        <span />
      )}
      <div className="text-[13px]" style={{ width: "68mm" }}>
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{money(document.subtotal)} SAR</span>
        </div>
        <div className="flex justify-between">
          <span>Total VAT</span>
          <span>{money(document.vatTotal)} SAR</span>
        </div>
        <div className="mt-1.5 flex justify-between border-t border-black pt-1.5 text-[17px] font-bold">
          <span>Total Payable</span>
          <span>{money(document.grandTotal)} SAR</span>
        </div>
      </div>
    </div>
  );
}

export function A4Note({ notes }: { notes: string }) {
  return (
    <div className="mt-4 rounded bg-[#eae7dd] p-2.5 text-[13px] leading-snug">Note: {truncateNote(notes)}</div>
  );
}

export function A4Footer() {
  return <div className="mt-5 text-center text-[11px] text-gray-400">Powered By: FatooraSync</div>;
}
