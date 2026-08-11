import { Prata, Inter } from "next/font/google";
import type { Tenant } from "@prisma/client";
import { paginateA4Items } from "@/lib/print-format/paginate-a4-items";
import {
  A4BusinessHeader,
  A4BilledTo,
  A4ItemsTable,
  A4Totals,
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
}: {
  tenant: Tenant;
  document: A4Document;
  qrImageDataUrl: string | null;
}) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);
  const pageItemCounts = paginateA4Items(document.lines.length);

  let cursor = 0;

  return (
    <div className={inter.className}>
      {pageItemCounts.map((count, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pageItemCounts.length - 1;
        const pageLines = document.lines.slice(cursor, cursor + count);
        const startIndex = cursor;
        cursor += count;

        return (
          <div
            key={pageIndex}
            className="a4-page mx-auto bg-white text-[9px] text-black"
            style={{ width: "210mm", minHeight: "297mm", padding: "20mm", boxSizing: "border-box", position: "relative" }}
          >
            <A4BusinessHeader
              tenant={tenant}
              document={document}
              docTitle="INVOICE"
              docNumberLabel="Invoice"
              prataClassName={prata.className}
            />
            <hr className="my-3 border-[#d8d4c8]" />
            {isFirstPage && <A4BilledTo customer={document.customer} />}
            <A4ItemsTable lines={pageLines} startIndex={startIndex} hasDiscount={hasDiscount} />
            {isLastPage && (
              <>
                {qrImageDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrImageDataUrl}
                    alt="ZATCA QR code"
                    className="absolute h-16 w-16"
                    style={{ bottom: "32mm", left: "20mm" }}
                  />
                )}
                <A4Totals document={document} />
                {document.notes && <A4Note notes={document.notes} />}
              </>
            )}
            <A4Footer />
          </div>
        );
      })}

      <PrintButton />

      <style>{`
        @media screen {
          .a4-page { margin-bottom: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
        }
        @media print {
          aside,
          [aria-hidden] { display: none !important; }
          div.border-b.border-border-subtle.backdrop-blur-sm { display: none !important; }
          .flex.h-screen { display: block !important; height: auto !important; }
          .overflow-hidden.bg-bg-app { overflow: visible !important; }
          main { padding: 0 !important; overflow: visible !important; }
          .a4-page { break-after: page; box-shadow: none !important; margin-bottom: 0 !important; }
          .a4-page:last-child { break-after: auto; }
        }
      `}</style>
    </div>
  );
}
