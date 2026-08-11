"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface QuotationRow {
  id: string;
  number: number;
  customerName: string;
  customerVatId: string | null;
  createdAt: string;
  grandTotal: string;
}

interface QuotationsResponse {
  quotations: QuotationRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY: QuotationsResponse = { quotations: [], total: 0, page: 1, pageSize: 10 };

export function QuotationHistoryClient({ initial }: { initial: QuotationsResponse }) {
  const [data, setData] = useState<QuotationsResponse>(initial);
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
      const response = await fetch(`/api/quotations?${params.toString()}`);
      if (!response.ok) {
        setError("Something went wrong loading quotations");
        setData(EMPTY);
        return;
      }
      const body: QuotationsResponse = await response.json();
      setData(body);
    } catch {
      setError("Something went wrong loading quotations");
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

  function goToPage(targetPage: number) {
    setPage(targetPage);
    fetchPage(targetPage);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Quotation #, customer name, or VAT ID"
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
              {search || dateFrom || dateTo ? "No matching quotations" : "No quotations yet — create your first one"}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quotation #</TableHead>
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
                data.quotations.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs">#{q.number}</TableCell>
                    <TableCell>
                      <div className="font-medium text-heading">{q.customerName}</div>
                      {q.customerVatId && <div className="text-xs text-muted-fg">{q.customerVatId}</div>}
                    </TableCell>
                    <TableCell>{q.createdAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-right font-semibold text-heading">
                      {Number(q.grandTotal).toFixed(2)} SAR
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/quotations/${q.id}/print`}>View</Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/api/quotations/${q.id}/pdf`}>Download</a>
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
