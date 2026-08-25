import { Document, Page, View, Text } from "@react-pdf/renderer";
import type { Tenant } from "@prisma/client";
import { paginateA4Items } from "@/lib/print-format/paginate-a4-items";
import { truncateNote } from "@/lib/print-format/truncate-note";
import {
  a4PdfStyles,
  A4BusinessHeader,
  A4BilledTo,
  A4ItemsTable,
  A4TotalsRow,
  A4Footer,
  type A4Document,
} from "@/lib/print-format/a4-pdf-parts";
import { formatQuotationNumber } from "@/lib/quotations/quotation-number";

export interface QuotationPdfA4Props {
  tenant: Tenant;
  document: A4Document;
}

export function QuotationPdfA4Document({ tenant, document }: QuotationPdfA4Props) {
  const hasDiscount = document.lines.some((line) => Number(line.discount) > 0);
  const pageItemCounts = paginateA4Items(document.lines.length);

  let cursor = 0;
  return (
    <Document>
      {pageItemCounts.map((count, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pageItemCounts.length - 1;
        const pageLines = document.lines.slice(cursor, cursor + count);
        const startIndex = cursor;
        cursor += count;

        return (
          <Page key={pageIndex} size="A4" style={a4PdfStyles.page}>
            <A4BusinessHeader
              tenant={tenant}
              document={document}
              docTitleEn="Quotation"
              docNumberLabel="Quotation"
              formatNumber={formatQuotationNumber}
            />
            <View style={a4PdfStyles.hr} />
            {isFirstPage && <A4BilledTo customer={document.customer} />}
            <A4ItemsTable lines={pageLines} startIndex={startIndex} hasDiscount={hasDiscount} />
            {isLastPage && (
              <>
                <A4TotalsRow document={document} />
                {document.notes && (
                  <View style={a4PdfStyles.note}>
                    <Text>Note: {truncateNote(document.notes)}</Text>
                  </View>
                )}
              </>
            )}
            <A4Footer />
          </Page>
        );
      })}
    </Document>
  );
}
