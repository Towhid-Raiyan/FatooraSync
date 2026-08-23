"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/language-provider";

interface VatStats {
  year: number;
  quarter: number;
  outgoingVat: string;
  incomingVat: string;
  netPayable: string;
}

const QUARTERS = [1, 2, 3, 4];

function quarterYearOptions(currentYear: number): number[] {
  return [currentYear, currentYear - 1, currentYear - 2];
}

const RADIUS = 80;
const STROKE = 28;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function VatDonut({ outgoing, incoming }: { outgoing: number; incoming: number }) {
  const { dict } = useLocale();
  const total = outgoing + incoming;
  const outgoingShare = total > 0 ? outgoing / total : 0.5;
  const outgoingLen = CIRCUMFERENCE * outgoingShare;
  const incomingLen = CIRCUMFERENCE - outgoingLen;

  return (
    <div className="relative mx-auto size-[200px]">
      <svg viewBox="0 0 200 200" className="size-full -rotate-90">
        <circle cx="100" cy="100" r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-border-subtle" />
        {total > 0 && (
          <>
            <circle
              cx="100"
              cy="100"
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeDasharray={`${outgoingLen} ${CIRCUMFERENCE - outgoingLen}`}
              strokeLinecap="butt"
              className="stroke-primary"
            />
            <circle
              cx="100"
              cy="100"
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeDasharray={`${incomingLen} ${CIRCUMFERENCE - incomingLen}`}
              strokeDashoffset={-outgoingLen}
              strokeLinecap="butt"
              className="stroke-emerald-500"
            />
          </>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-heading">{Math.round(outgoingShare * 100)}%</span>
        <span className="text-[11px] text-muted-fg">{dict.statistics.chartOutgoingShare}</span>
      </div>
    </div>
  );
}

export function StatisticsClient({ initial }: { initial: VatStats }) {
  const { dict } = useLocale();
  const [year, setYear] = useState(initial.year);
  const [quarter, setQuarter] = useState(initial.quarter);
  const [stats, setStats] = useState<VatStats>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getUTCFullYear();

  useEffect(() => {
    if (year === initial.year && quarter === initial.quarter) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/statistics/vat?year=${year}&quarter=${quarter}`)
      .then((response) => {
        if (!response.ok) throw new Error("failed");
        return response.json();
      })
      .then((body) => {
        if (!cancelled) setStats(body);
      })
      .catch(() => {
        if (!cancelled) setError(dict.statistics.loadError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, quarter]);

  const outgoing = Number(stats.outgoingVat);
  const incoming = Number(stats.incomingVat);
  const net = Number(stats.netPayable);
  const isRefund = net < 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-heading">{dict.statistics.title}</h1>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              {dict.statistics.ownerOnlyBadge}
            </span>
          </div>
          <p className="max-w-xl text-sm text-muted-fg">{dict.statistics.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {QUARTERS.map((q) => (
              <option key={q} value={q}>
                {dict.statistics.quarterLabel(q, year)}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {quarterYearOptions(currentYear).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        <CardContent className={`grid grid-cols-1 gap-8 py-8 md:grid-cols-2 ${loading ? "opacity-50" : ""}`}>
          <VatDonut outgoing={outgoing} incoming={incoming} />
          <div className="flex flex-col justify-center gap-4">
            <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-app px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full bg-primary" />
                <div>
                  <div className="text-sm font-semibold text-heading">{dict.statistics.outgoingVat}</div>
                  <div className="text-xs text-muted-fg">{dict.statistics.outgoingVatCaption}</div>
                </div>
              </div>
              <span className="text-lg font-bold text-heading">{outgoing.toFixed(2)} SAR</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-app px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" />
                <div>
                  <div className="text-sm font-semibold text-heading">{dict.statistics.incomingVat}</div>
                  <div className="text-xs text-muted-fg">{dict.statistics.incomingVatCaption}</div>
                </div>
              </div>
              <span className="text-lg font-bold text-heading">{incoming.toFixed(2)} SAR</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        <CardHeader>
          <CardTitle className="text-heading">{isRefund ? dict.statistics.netRefund : dict.statistics.netPayable}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <span className={`text-3xl font-bold ${isRefund ? "text-emerald-600" : "text-heading"}`}>
            {Math.abs(net).toFixed(2)} SAR
          </span>
          <p className="text-xs text-muted-fg">{dict.statistics.netNote}</p>
        </CardContent>
      </Card>
    </div>
  );
}
