"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PAGE_SIZE } from "@/lib/receipts/constants";
import { useLocale } from "@/lib/i18n/language-provider";
import { PurchaseDetailModal } from "./purchase-detail-modal";

export interface PurchaseReceiptRow {
  id: string;
  number: number;
  supplierReceiptNumber: string | null;
  supplierName: string;
  purchaseDate: string;
  paymentMethod: "CASH" | "CREDIT";
  grandTotal: string;
}

export interface PurchaseReceiptsResponse {
  receipts: PurchaseReceiptRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY: PurchaseReceiptsResponse = { receipts: [], total: 0, page: 1, pageSize: PAGE_SIZE };

export function PurchaseHistoryClient({
  initial,
  refreshKey,
}: {
  initial: PurchaseReceiptsResponse;
  refreshKey: number;
}) {
  const { dict } = useLocale();
  const [data, setData] = useState<PurchaseReceiptsResponse>(initial);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRun = useRef(true);
  const lastRefreshKey = useRef(refreshKey);

  async function fetchPage(targetPage: number) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (search.trim()) params.set("search", search.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await fetch(`/api/purchase-receipts?${params.toString()}`);
      if (!response.ok) {
        setError(dict.purchases.loadError);
        setData(EMPTY);
        return;
      }
      const body: PurchaseReceiptsResponse = await response.json();
      setData(body);
    } catch {
      setError(dict.purchases.loadError);
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo]);

  // A freshly saved purchase receipt lands here via a parent-owned counter
  // (rather than this component's own state) -- InventoryClient bumps it once
  // per successful save, so this refetches page 1 without needing its own
  // save-callback plumbing.
  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    setPage(1);
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function goToPage(targetPage: number) {
    setPage(targetPage);
    fetchPage(targetPage);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={dict.purchases.historySearchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72"
        />
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[calc(50%-1.25rem)] sm:w-40" />
        <span className="text-sm text-muted-fg">{dict.common.to}</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[calc(50%-1.25rem)] sm:w-40" />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {data.total === 0 && !loading ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">
              {search || dateFrom || dateTo ? dict.purchases.historyNoMatching : dict.purchases.historyNoneYet}
            </p>
          </div>
        ) : loading ? (
          <div className="py-10 text-center text-sm text-muted-fg">{dict.common.loading}</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{dict.purchases.columnPurchaseNumber}</TableHead>
                    <TableHead>{dict.purchases.columnSupplier}</TableHead>
                    <TableHead>{dict.purchases.columnDate}</TableHead>
                    <TableHead>{dict.purchases.columnPayment}</TableHead>
                    <TableHead className="text-right">{dict.purchases.columnTotal}</TableHead>
                    <TableHead className="text-right">{dict.common.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">#{r.number}</TableCell>
                      <TableCell>
                        <div className="font-medium text-heading">{r.supplierName}</div>
                        {r.supplierReceiptNumber && (
                          <div className="text-xs text-muted-fg">{r.supplierReceiptNumber}</div>
                        )}
                      </TableCell>
                      <TableCell>{r.purchaseDate.slice(0, 10)}</TableCell>
                      <TableCell>
                        {r.paymentMethod === "CASH" ? dict.purchases.paymentCash : dict.purchases.paymentCredit}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-heading">
                        {Number(r.grandTotal).toFixed(2)} SAR
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setDetailId(r.id)}>
                          {dict.common.view}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border-subtle md:hidden">
              {data.receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="font-medium text-heading">
                      <span className="font-mono text-xs text-muted-fg">#{r.number}</span> {r.supplierName}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-fg">
                      <span>{r.purchaseDate.slice(0, 10)}</span>
                      <span>{r.paymentMethod === "CASH" ? dict.purchases.paymentCash : dict.purchases.paymentCredit}</span>
                      <span className="font-semibold text-heading">{Number(r.grandTotal).toFixed(2)} SAR</span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => setDetailId(r.id)}>
                    {dict.common.view}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-fg">
          <span>{dict.common.totalMatches(data.total)}</span>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>
              {dict.common.previous}
            </Button>
            <span>{dict.common.pageOf(page, totalPages)}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => goToPage(page + 1)}
            >
              {dict.common.next}
            </Button>
          </div>
        </div>
      )}

      <PurchaseDetailModal purchaseReceiptId={detailId} onOpenChange={(open) => !open && setDetailId(null)} />
    </div>
  );
}
