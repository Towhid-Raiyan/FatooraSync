"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Camera, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getUnitLabels } from "@/components/products/product-form-dialog";
import { BarcodeScannerModal } from "@/components/barcode-scanner-modal";
import type { SerializedProduct } from "@/components/products/products-client";
import type { LineTotals } from "@/lib/receipts/calculate-totals";
import { formatQuotationNumber, parseQuotationNumberQuery } from "@/lib/quotations/quotation-number";
import { useLocale } from "@/lib/i18n/language-provider";
import { cn } from "@/lib/utils";

export interface QuotationSuggestion {
  id: string;
  number: number;
  customerName: string;
  grandTotal: string;
}

export interface ReceiptLine {
  key: string;
  productId: string;
  sku: string | null;
  productName: string;
  productNameAr: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vatRate: string | null;
  stockAtAdd: string;
}

interface ItemsSectionProps {
  products: SerializedProduct[];
  lines: ReceiptLine[];
  lineTotals: LineTotals[]; // same length/order as `lines` -- the resolved-VAT truth, computed once in ReceiptForm
  onAddLine: (product: SerializedProduct) => void;
  onRemoveLine: (key: string) => void;
  onQuantityChange: (key: string, quantity: string) => void;
  onUnitPriceChange: (key: string, unitPrice: string) => void;
  onDiscountChange: (key: string, discount: string) => void;
  onTotalChange: (key: string, total: string) => void;
  onOpenQuickCreate: () => void;
  // Only provided by the New Receipt page (receipt-form.tsx) -- New Quotation
  // uses this same component without it, which simply leaves the
  // quotation-number-lookup branch of the search box inactive. "Load from
  // a quotation" only makes sense when building a receipt.
  onSelectQuotation?: (quotationId: string) => void | Promise<void>;
  className?: string;
}

export function ItemsSection({
  products,
  lines,
  lineTotals,
  onAddLine,
  onRemoveLine,
  onQuantityChange,
  onUnitPriceChange,
  onDiscountChange,
  onTotalChange,
  onOpenQuickCreate,
  onSelectQuotation,
  className,
}: ItemsSectionProps) {
  const { dict } = useLocale();
  const unitLabels = getUnitLabels(dict);
  const [search, setSearch] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [quotationMatches, setQuotationMatches] = useState<QuotationSuggestion[]>([]);
  const quotationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A query that parses as a quotation number ("QTE132", "132", "#132") takes
  // over the whole dropdown -- product name/SKU never look like this, so there's
  // no real ambiguity to resolve between the two searches.
  const quotationQueryNumber = onSelectQuotation ? parseQuotationNumberQuery(search) : null;

  useEffect(() => {
    if (quotationQueryNumber === null) {
      setQuotationMatches([]);
      return;
    }
    if (quotationDebounceRef.current) clearTimeout(quotationDebounceRef.current);
    quotationDebounceRef.current = setTimeout(() => {
      fetch(`/api/quotations?number=${quotationQueryNumber}`)
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((body: { quotations: QuotationSuggestion[] }) => setQuotationMatches(body.quotations))
        .catch(() => setQuotationMatches([]));
    }, 250);
    return () => {
      if (quotationDebounceRef.current) clearTimeout(quotationDebounceRef.current);
    };
  }, [quotationQueryNumber]);

  function handleSelectQuotation(quotationId: string) {
    setSearch("");
    onSelectQuotation?.(quotationId);
  }

  // Editing Total is a reverse calculation (it back-solves Unit Price), so the
  // displayed total is normally the computed `lineTotal` -- except while a cell is
  // actively focused, when it shows exactly what was typed so far. Committing
  // (blur) is what triggers the actual recalculation; recomputing on every
  // keystroke would fight the cursor as `lineTotal` snaps back mid-edit.
  const [totalDrafts, setTotalDrafts] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return products.filter(
      (p) =>
        p.nameEn.toLowerCase().includes(query) ||
        (p.nameAr ?? "").toLowerCase().includes(query) ||
        (p.sku ?? "").toLowerCase().includes(query) ||
        (p.barcode ?? "").toLowerCase().includes(query)
    );
  }, [products, search]);

  function handleSelect(product: SerializedProduct) {
    onAddLine(product);
    setSearch("");
  }

  // A physical USB/Bluetooth scanner "types" the barcode into whatever input is
  // focused and ends with Enter -- no library needed for that half of scanning.
  // On Enter, prefer an exact barcode match (what a real scan produces); a
  // single fuzzy match (e.g. an SKU typed and confirmed by hand) is also
  // accepted so Enter doesn't feel dead when there's only one candidate.
  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (quotationQueryNumber !== null) {
      if (quotationMatches.length === 1) handleSelectQuotation(quotationMatches[0].id);
      return;
    }
    const query = search.trim().toLowerCase();
    if (!query) return;
    const exactBarcode = products.find((p) => (p.barcode ?? "").toLowerCase() === query);
    if (exactBarcode) {
      handleSelect(exactBarcode);
    } else if (filtered.length === 1) {
      handleSelect(filtered[0]);
    }
  }

  // Camera scan: same exact-barcode-first resolution as the physical scanner.
  // If nothing matches, drop the code into the search field so the cashier can
  // see what was scanned and search manually instead of it silently vanishing.
  function handleBarcodeDetected(code: string) {
    const match = products.find((p) => (p.barcode ?? "").toLowerCase() === code.trim().toLowerCase());
    if (match) {
      handleSelect(match);
    } else {
      setSearch(code);
    }
  }

  // Only commits if the draft actually differs from what the field was seeded
  // with on focus. Without this check, simply tabbing through a Total cell with
  // no edit still round-trips through the back-calculation -- and because
  // `deriveUnitPriceFromTotal` inverts continuous-math while `calculateLine`
  // rounds at several points, a no-op focus/blur could silently nudge the unit
  // price by a cent on fractional quantities.
  function commitTotalDraft(key: string, seededValue: string) {
    const draft = totalDrafts[key];
    if (draft !== undefined && draft !== seededValue) {
      onTotalChange(key, draft);
    }
    setTotalDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  return (
    <Card
      className={cn(
        // Card's own base classes default to overflow-hidden (needed elsewhere to
        // clip a card's own rounded corners). That also clips this card's search
        // results dropdown to the card's own height -- fine on desktop where the
        // card is tall, but on mobile the card starts short (no items yet) and the
        // dropdown got cut off mid-list. Overriding to visible lets it draw over
        // whatever's below, which is the point of an absolutely-positioned popover.
        "flex flex-col overflow-visible border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] [--card-spacing:18.5px]",
        className
      )}
    >
      <CardHeader className="shrink-0">
        <CardTitle className="text-heading">{dict.documentForm.itemsSection.title}</CardTitle>
      </CardHeader>
      {/* flex-1/min-h-0 only apply at xl+ (desktop), where the outer grid stretches
          this card to fill row 2's full height and only the rows below scroll. Below
          xl the card isn't stretched at all -- without the xl: prefix here, flex-1
          on a card with no imposed height was quietly starving the rows list of any
          usable height, so newly added rows rendered into a near-zero-height nested
          scroll box instead of growing the card. */}
      <CardContent className="flex flex-col space-y-3 xl:min-h-0 xl:flex-1">
        <div className="flex shrink-0 gap-2">
          <div className="relative flex-1">
            <Input
              ref={searchInputRef}
              placeholder={dict.documentForm.itemsSection.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              autoFocus
            />
            {search.trim() && (
              <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-card shadow-[0_4px_16px_rgba(16,44,30,0.12)]">
                {quotationQueryNumber !== null ? (
                  <>
                    {quotationMatches.map((quotation) => (
                      <button
                        key={quotation.id}
                        type="button"
                        onClick={() => handleSelectQuotation(quotation.id)}
                        className="block w-full px-3 py-2 text-start text-sm hover:bg-bg-app"
                      >
                        <Badge variant="secondary" className="me-1.5">
                          {dict.documentForm.itemsSection.quotationBadge}
                        </Badge>
                        <span className="font-mono text-xs text-muted-fg">
                          {formatQuotationNumber(quotation.number)}
                        </span>{" "}
                        <span className="text-heading">{quotation.customerName}</span>{" "}
                        <span className="text-muted-fg">— {Number(quotation.grandTotal).toFixed(2)} SAR</span>
                      </button>
                    ))}
                    {quotationMatches.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-fg">
                        {dict.documentForm.itemsSection.noQuotationMatch}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {filtered.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handleSelect(product)}
                        className="block w-full px-3 py-2 text-start text-sm hover:bg-bg-app"
                      >
                        <span className="font-mono text-xs text-muted-fg">{product.sku}</span>{" "}
                        <span className="text-heading">{product.nameEn}</span>{" "}
                        <span className="text-muted-fg">— {product.unitPrice}</span>
                      </button>
                    ))}
                    {filtered.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-fg">{dict.documentForm.itemsSection.noMatches}</div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={dict.barcodeScanner.scanWithCamera}
            title={dict.barcodeScanner.scanWithCamera}
            className="shrink-0"
            onClick={() => setScannerOpen(true)}
          >
            <Camera className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onOpenQuickCreate} className="shrink-0">
            {dict.common.addProduct}
          </Button>
        </div>

        {lines.length > 0 && (
          // `flex-1 min-h-0 overflow-y-auto` makes this the only scrolling region on
          // the whole page: the card fills the grid row assigned to it in
          // receipt-form.tsx/quotation-form.tsx, the search bar and Add Product
          // button above stay fixed (`shrink-0`), and only these rows scroll.
          // Horizontal scroll is the Table component's own built-in behavior (its
          // internal wrapper is `overflow-x-auto`) for when the row's columns don't
          // all fit. Actions used to be `sticky right-0` to stay visible during that
          // scroll, but `position: sticky` overlaps whatever's underneath it
          // unconditionally -- even when the table isn't actually scrolled, it still
          // floated on top of the tail end of the Total column, hiding it. The
          // column widths below (plus the wider Items/Customer split) are sized so
          // the table fits without needing horizontal scroll for realistic data,
          // which makes the sticky behavior both unnecessary and actively harmful --
          // a plain in-flow column has no such overlap risk.
          <div className="rounded-lg border border-border-subtle xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dict.documentForm.itemsSection.headers.number}</TableHead>
                  <TableHead>{dict.documentForm.itemsSection.headers.sku}</TableHead>
                  <TableHead>{dict.documentForm.itemsSection.headers.product}</TableHead>
                  <TableHead>{dict.documentForm.itemsSection.headers.unit}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.qty}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.price}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.disc}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.vat}</TableHead>
                  <TableHead className="text-right">{dict.documentForm.itemsSection.headers.total}</TableHead>
                  <TableHead className="bg-bg-card text-right">
                    {dict.documentForm.itemsSection.headers.actions}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const exceedsStock = Number(line.quantity) > Number(line.stockAtAdd);
                  const rawSubtotal = Number(line.unitPrice) * Number(line.quantity);
                  const discountExceedsSubtotal = Number(line.discount) > rawSubtotal;
                  const { lineVat, lineTotal } = lineTotals[index];
                  return (
                    <TableRow key={line.key} className="group">
                      <TableCell className="text-muted-fg">{index + 1}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {line.sku ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-heading">{line.productName}</div>
                        {line.productNameAr && (
                          <div className="text-xs text-emerald-600 dark:text-emerald-400">{line.productNameAr}</div>
                        )}
                        {exceedsStock && (
                          <div className="text-xs text-amber-600">{dict.documentForm.itemsSection.exceedsStock}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-fg">{unitLabels[line.unit] ?? line.unit}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={line.quantity}
                          onChange={(e) => onQuantityChange(line.key, e.target.value)}
                          className="w-16 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          value={line.unitPrice}
                          onChange={(e) => onUnitPriceChange(line.key, e.target.value)}
                          className="w-24 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.discount}
                          onChange={(e) => onDiscountChange(line.key, e.target.value)}
                          className="w-16 text-right"
                        />
                        {discountExceedsSubtotal && (
                          <div className="text-xs text-red-600">{dict.documentForm.itemsSection.exceedsSubtotal}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-fg">{lineVat.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={totalDrafts[line.key] ?? lineTotal.toFixed(2)}
                          onFocus={() =>
                            setTotalDrafts((prev) => ({ ...prev, [line.key]: lineTotal.toFixed(2) }))
                          }
                          onChange={(e) =>
                            setTotalDrafts((prev) => ({ ...prev, [line.key]: e.target.value }))
                          }
                          onBlur={() => commitTotalDraft(line.key, lineTotal.toFixed(2))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          className="w-24 text-right font-semibold text-heading"
                        />
                      </TableCell>
                      <TableCell className="text-right group-hover:bg-muted/50">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label={dict.a11y.confirmLine}
                            onClick={() => searchInputRef.current?.focus()}
                            className="rounded-md p-1 text-emerald-600 hover:bg-emerald-600/10"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={dict.a11y.removeItem}
                            onClick={() => onRemoveLine(line.key)}
                            className="rounded-md p-1 text-red-600 hover:bg-red-600/10"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <BarcodeScannerModal open={scannerOpen} onOpenChange={setScannerOpen} onDetected={handleBarcodeDetected} />
    </Card>
  );
}
