export interface QuarterRange {
  start: Date;
  end: Date;
}

// Quarter boundaries in UTC, inclusive start / exclusive-at-the-next-instant
// end (end is the last millisecond of the quarter) -- matches the
// gte/lte date-range convention already used across the receipt/quotation
// history filters (see e.g. src/app/api/quotations/route.ts).
export function getQuarterRange(year: number, quarter: number): QuarterRange {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
  return { start, end };
}

export function getCurrentQuarter(): { year: number; quarter: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), quarter: Math.floor(now.getUTCMonth() / 3) + 1 };
}
