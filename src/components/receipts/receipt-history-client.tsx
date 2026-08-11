"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PAGE_SIZE } from "@/lib/receipts/constants";

interface ReceiptRow {
  id: string;
  number: number;
  customerName: string;
  customerVatId: string | null;
  createdAt: string;
  grandTotal: string;
}

interface ReceiptsResponse {
  receipts: ReceiptRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY: ReceiptsResponse = { receipts: [], total: 0, page: 1, pageSize: PAGE_SIZE };

export function ReceiptHistoryClient({ initial }: { initial: ReceiptsResponse }) {
  const [data, setData] = useState<ReceiptsResponse>(initial);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRun = useRef(true);

  async function fetchPage(targetPage: number) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (search.trim()) params.set("search", search.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await fetch(`/api/receipts?${params.toString()}`);
      if (!response.ok) {
        setError("Something went wrong loading receipts");
        setData(EMPTY);
        return;
      }
      const body: ReceiptsResponse = await response.json();
      setData(body);
    } catch {
      setError("Something went wrong loading receipts");
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }

  // Debounced re-fetch on search/date change -- resets to page 1, since the
  // previous page number may no longer make sense against a new filter's
  // result set. Skipped on first mount: the server already provided page 1
  // with no filters via the initial prop, so an immediate re-fetch here would
  // just be a redundant duplicate of that same request.
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

  function goToPage(targetPage: number) {
    setPage(targetPage);
    fetchPage(targetPage);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Receipt #, customer name, or VAT ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        <span className="text-sm text-muted-fg">to</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
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
              {search || dateFrom || dateTo ? "No matching receipts" : "No receipts yet — create your first one"}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-fg">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : (
                data.receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.number}</TableCell>
                    <TableCell>
                      <div className="font-medium text-heading">{r.customerName}</div>
                      {r.customerVatId && <div className="text-xs text-muted-fg">{r.customerVatId}</div>}
                    </TableCell>
                    <TableCell>{r.createdAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-right font-semibold text-heading">
                      {Number(r.grandTotal).toFixed(2)} SAR
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/receipts/${r.id}/print`}>View</Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/api/receipts/${r.id}/pdf`}>Download</a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-fg">
          <span>
            {data.total} total match{data.total === 1 ? "" : "es"}
          </span>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>
              ← Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => goToPage(page + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
