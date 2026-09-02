import { Prata, Inter } from "next/font/google";
import type { Tenant } from "@prisma/client";
import { paginateA4Items } from "@/lib/print-format/paginate-a4-items";
import {
  A4BusinessHeader,
  A4BilledTo,
  A4ItemsTable,
  A4TotalsRow,
  A4Note,
  A4Footer,
  type A4Document,
} from "@/components/print-format/a4-print-parts";
import { PrintButton } from "./print-button";

const prata = Prata({ subsets: ["latin"], weight: "400" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "600"] });

export function ReceiptPrintA4({
  tenant,
  document,
  qrImageDataUrl,
  showPrintButton = true,
}: {
  tenant: Tenant;
  document: A4Document;
  qrImageDataUrl: string | null;
  showPrintButton?: boolean;
}) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);
  const pageItemCounts = paginateA4Items(document.lines.length);

  let cursor = 0;

  return (
    <div id="print-target" className={`${inter.className} font-sans`} dir="ltr">
      {pageItemCounts.map((count, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pageItemCounts.length - 1;
        const pageLines = document.lines.slice(cursor, cursor + count);
        const startIndex = cursor;
        cursor += count;

        return (
          <div
            key={pageIndex}
            className="a4-page mx-auto bg-white text-[13px] text-black"
            style={{ width: "210mm", minHeight: "297mm", padding: "18mm", boxSizing: "border-box", position: "relative" }}
          >
            <A4BusinessHeader
              tenant={tenant}
              document={document}
              docTitleEn={document.type === "CREDIT_NOTE" ? "Credit Note" : "Simplified Tax Invoice"}
              docTitleAr={document.type === "CREDIT_NOTE" ? "إشعار دائن" : "فاتورة ضريبية مبسطة"}
              docNumberLabel={document.type === "CREDIT_NOTE" ? "Credit Note" : "Invoice"}
              prataClassName={prata.className}
            />
            <hr className="my-3 border-[#d8d4c8]" />
            {isFirstPage && <A4BilledTo customer={document.customer} />}
            <A4ItemsTable lines={pageLines} startIndex={startIndex} hasDiscount={hasDiscount} />
            {isLastPage && (
              <>
                <A4TotalsRow document={document} qrImageDataUrl={qrImageDataUrl} />
                {document.notes && <A4Note notes={document.notes} />}
              </>
            )}
            <A4Footer />
          </div>
        );
      })}

      {showPrintButton && <PrintButton />}

      <style>{`
        @media screen {
          .a4-page { margin-bottom: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
        }
        @media print {
          /* Without this, the browser's own default print margins (commonly
             ~12-25mm on all sides) stack on top of the page's own 18mm padding,
             shrinking the true printable area below what the page was designed
             for -- which is exactly what pushed the bottom of the page (the
             note/totals block) onto a second physical sheet even for short
             documents. Zeroing the browser margin makes our own padding the
             only margin, matching what the layout was actually measured against. */
          @page { size: A4; margin: 0; }
          .a4-page { box-shadow: none !important; margin-bottom: 0 !important; }
          .a4-page + .a4-page { break-before: page; }
        }
      `}</style>
    </div>
  );
}
