import { PrintButton } from "@/components/receipts/print-button";

export interface LabelPrintItem {
  productId: string;
  productName: string;
  price: string;
  barcodeText: string;
  barcodeDataUrl: string;
  copies: number;
}

export function LabelPrintHtml({
  tenantTradeName,
  items,
  labelWidthMm,
  labelHeightMm,
  showPrintButton = true,
}: {
  tenantTradeName: string;
  items: LabelPrintItem[];
  labelWidthMm: number;
  labelHeightMm: number;
  showPrintButton?: boolean;
}) {
  const labels: LabelPrintItem[] = [];
  for (const item of items) {
    for (let i = 0; i < item.copies; i++) labels.push(item);
  }

  return (
    // Labels print off a continuous roll, not a fixed sheet -- same reasoning
    // as the thermal receipt templates: width comes from the tenant's
    // configured label size, height is just as many repeated labels as requested.
    <div id="print-target" className="mx-auto bg-white" style={{ width: `${labelWidthMm}mm` }} dir="ltr">
      {labels.map((item, index) => (
        <div
          key={`${item.productId}-${index}`}
          className="flex flex-col items-center justify-center border-b border-dashed border-gray-300 px-1 text-center text-black"
          style={{ height: `${labelHeightMm}mm`, breakInside: "avoid" }}
        >
          <div className="text-[8px] font-bold">{tenantTradeName}</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not an optimizable static asset */}
          <img
            src={item.barcodeDataUrl}
            alt=""
            className="mt-0.5"
            style={{ width: "80%", height: `${Math.max(labelHeightMm * 0.32, 6)}mm` }}
          />
          <div className="text-[6px] text-gray-600">{item.barcodeText}</div>
          <div className="mt-0.5 text-[7px] font-bold leading-tight">{item.productName}</div>
          <div className="mt-0.5 text-[9px] font-bold">SAR {item.price}</div>
          <div className="text-[5.5px] text-gray-500">(Incl. of all taxes)</div>
        </div>
      ))}

      {showPrintButton && <PrintButton />}

      <style>{`
        @media print {
          @page { size: ${labelWidthMm}mm auto; margin: 0; }
        }
      `}</style>
    </div>
  );
}
