"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/language-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { ReceiptPrintThermal } from "@/components/receipts/receipt-print-thermal";
import { ReceiptPrintA4 } from "@/components/receipts/receipt-print-a4";
import { QuotationPrintThermal } from "@/components/quotations/quotation-print-thermal";
import { QuotationPrintA4 } from "@/components/quotations/quotation-print-a4";

interface PrintDataLine {
  id: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  lineVat: string;
  lineTotal: string;
}

interface PrintDataDocument {
  number: number;
  createdAt: string;
  subtotal: string;
  vatTotal: string;
  grandTotal: string;
  notes: string | null;
  customer: { name: string; vatId: string | null; crNumber: string | null; phone: string | null; address: string | null };
  lines: PrintDataLine[];
}

interface PrintData {
  printFormat: "THERMAL" | "A4";
  tenant: {
    tradeNameEn: string;
    tradeNameAr: string | null;
    legalName: string;
    vatNumber: string;
    crNumber: string | null;
    phone: string | null;
    address: string | null;
  };
  document: PrintDataDocument;
  qrImageDataUrl: string | null;
}

export function PrintModal({
  kind,
  documentId,
  onOpenChange,
}: {
  kind: "receipt" | "quotation";
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { dict } = useLocale();
  const { toast } = useToast();
  const [data, setData] = useState<PrintData | null>(null);
  const [loading, setLoading] = useState(false);
  const requestedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!documentId) {
      setData(null);
      return;
    }
    requestedIdRef.current = documentId;
    setLoading(true);
    fetch(`/api/${kind}s/${documentId}/print-data`)
      .then((response) => {
        if (!response.ok) throw new Error("failed to load print data");
        return response.json();
      })
      .then((body: PrintData) => {
        if (requestedIdRef.current === documentId) setData(body);
      })
      .catch(() => {
        if (requestedIdRef.current === documentId) {
          toast.error(dict.common.somethingWentWrong);
          onOpenChange(false);
        }
      })
      .finally(() => {
        if (requestedIdRef.current === documentId) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, documentId]);

  const open = documentId !== null;

  // A genuine Date instance, reconstructed once per fetch -- every print
  // component keeps calling `.toISOString()` on this exactly as it already
  // does for the server-rendered path, unchanged in Task 5.
  const documentForPrint = data
    ? {
        ...data.document,
        createdAt: new Date(data.document.createdAt),
      }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-6xl">
        <DialogTitle className="sr-only">
          {kind === "receipt" ? dict.printChrome.receiptTitle : dict.printChrome.quotationTitle}
        </DialogTitle>
        {loading || !data || !documentForPrint ? (
          <div className="flex items-center justify-center py-24">
            <Loader2Icon className="size-6 animate-spin text-muted-fg" />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-auto">
              {kind === "receipt" ? (
                data.printFormat === "A4" ? (
                  <ReceiptPrintA4
                    tenant={data.tenant as never}
                    document={documentForPrint as never}
                    qrImageDataUrl={data.qrImageDataUrl}
                    showPrintButton={false}
                  />
                ) : (
                  <ReceiptPrintThermal
                    tenant={data.tenant as never}
                    document={documentForPrint as never}
                    qrImageDataUrl={data.qrImageDataUrl}
                    showPrintButton={false}
                  />
                )
              ) : data.printFormat === "A4" ? (
                <QuotationPrintA4 tenant={data.tenant as never} document={documentForPrint as never} showPrintButton={false} />
              ) : (
                <QuotationPrintThermal tenant={data.tenant as never} document={documentForPrint as never} showPrintButton={false} />
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" asChild>
                <a href={`/api/${kind}s/${documentId}/pdf`}>{dict.common.download}</a>
              </Button>
              <Button variant="primary" onClick={() => window.print()}>
                {dict.printChrome.print}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
