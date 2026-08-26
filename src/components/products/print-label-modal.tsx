"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/language-provider";
import type { SerializedProduct } from "./products-client";
import { LabelPrintHtml, type LabelPrintItem } from "./label-print";

interface DraftItem {
  productId: string;
  productName: string;
  sku: string | null;
  copies: string;
}

interface PrintDataResponse {
  tenantTradeName: string;
  labelWidthMm: number;
  labelHeightMm: number;
  items: LabelPrintItem[];
}

// Opened from a single product's "Print label" row action (product-client.tsx),
// pre-loaded with just that one product -- but the search box inside lets the
// same modal grow into a batch print for several products in one job, so
// there's one place this lives regardless of whether a tenant prints one label
// at a time or a dozen at once. See the "compose" (editable list) vs "preview"
// (rendered labels, ready to print) split below: printing/downloading always
// re-fetches from the server, since price/barcode must reflect the product's
// current data, not whatever was true when the modal opened.
export function PrintLabelModal({
  product,
  products,
  onOpenChange,
}: {
  product: SerializedProduct | null;
  products: SerializedProduct[];
  onOpenChange: (open: boolean) => void;
}) {
  const { dict } = useLocale();
  const [items, setItems] = useState<DraftItem[]>([]);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"compose" | "preview">("compose");
  const [printData, setPrintData] = useState<PrintDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = product !== null;

  useEffect(() => {
    if (product) {
      setItems([{ productId: product.id, productName: product.nameEn, sku: product.sku, copies: "1" }]);
      setSearch("");
      setMode("compose");
      setPrintData(null);
      setError(null);
    }
  }, [product]);

  const suggestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const addedIds = new Set(items.map((i) => i.productId));
    return products
      .filter((p) => !addedIds.has(p.id))
      .filter(
        (p) =>
          p.nameEn.toLowerCase().includes(query) ||
          (p.nameAr ?? "").toLowerCase().includes(query) ||
          (p.sku ?? "").toLowerCase().includes(query)
      )
      .slice(0, 8);
  }, [products, search, items]);

  function addProduct(p: SerializedProduct) {
    setItems((prev) => [...prev, { productId: p.id, productName: p.nameEn, sku: p.sku, copies: "1" }]);
    setSearch("");
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  function updateCopies(productId: string, copies: string) {
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, copies } : i)));
  }

  const totalCopies = items.reduce((sum, i) => sum + (Number(i.copies) || 0), 0);

  function buildPayload() {
    return {
      items: items.map((i) => ({ productId: i.productId, copies: Math.max(1, Math.floor(Number(i.copies) || 0)) })),
    };
  }

  async function handlePreparePrint() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/products/labels/print-data", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? dict.printLabel.loadError);
        return;
      }
      setPrintData(body);
      setMode("preview");
    } catch {
      setError(dict.printLabel.loadError);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch("/api/products/labels/pdf", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? dict.printLabel.loadError);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "barcode-labels.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(dict.printLabel.loadError);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dict.printLabel.dialogTitle}</DialogTitle>
        </DialogHeader>

        {mode === "compose" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="relative shrink-0">
              <Input
                placeholder={dict.printLabel.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search.trim() && (
                <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
                  {suggestions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProduct(p)}
                      className="block w-full px-3 py-2 text-start text-sm hover:bg-bg-app"
                    >
                      <span className="font-mono text-xs text-muted-fg">{p.sku}</span>{" "}
                      <span className="text-heading">{p.nameEn}</span>
                    </button>
                  ))}
                  {suggestions.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-fg">{dict.printLabel.noMatches}</div>
                  )}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border-subtle">
              {items.map((item) => (
                <div
                  key={item.productId}
                  className="flex items-center justify-between gap-2 border-b border-border-subtle p-2.5 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-heading">{item.productName}</div>
                    {item.sku && (
                      <Badge variant="outline" className="mt-0.5 font-mono">
                        {item.sku}
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Label className="sr-only" htmlFor={`copies-${item.productId}`}>
                      {dict.printLabel.copies}
                    </Label>
                    <Input
                      id={`copies-${item.productId}`}
                      type="number"
                      min="1"
                      value={item.copies}
                      onChange={(e) => updateCopies(item.productId, e.target.value)}
                      className="w-16 text-right"
                    />
                    <button
                      type="button"
                      aria-label={dict.printLabel.removeItem}
                      onClick={() => removeItem(item.productId)}
                      className="rounded-md p-1 text-red-600 hover:bg-red-600/10"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}
          </div>
        ) : printData ? (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-dashed border-border-subtle bg-bg-app p-3">
            <LabelPrintHtml
              tenantTradeName={printData.tenantTradeName}
              items={printData.items}
              labelWidthMm={printData.labelWidthMm}
              labelHeightMm={printData.labelHeightMm}
              showPrintButton={false}
            />
          </div>
        ) : null}

        <DialogFooter>
          {mode === "compose" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {dict.common.cancel}
              </Button>
              <Button variant="outline" disabled={items.length === 0 || downloading} onClick={handleDownload}>
                {downloading && <Loader2Icon className="size-3.5 animate-spin" />}
                {dict.common.download}
              </Button>
              <Button variant="primary" disabled={items.length === 0 || loading} onClick={handlePreparePrint}>
                {loading && <Loader2Icon className="size-3.5 animate-spin" />}
                {dict.printLabel.print(totalCopies)}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode("compose")}>
                {dict.printLabel.backToEdit}
              </Button>
              <Button variant="primary" onClick={() => window.print()}>
                {dict.printChrome.print}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
