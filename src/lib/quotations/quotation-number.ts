// Quotation numbers are stored as a plain auto-incrementing integer
// (Document.number, already unique per tenant+type -- see
// Tenant.nextQuotationNumber) and only carry the "QTE" prefix at display/search
// time, not in the database. This keeps the counter itself simple while every
// print/list surface and the number-lookup search show/accept the prefixed form.
export function formatQuotationNumber(number: number): string {
  return `QTE${number}`;
}

// Accepts "QTE132", "qte132", "#132", or a bare "132" and returns the parsed
// integer, or null if the remainder after stripping isn't a valid number.
export function parseQuotationNumberQuery(query: string): number | null {
  const stripped = query.trim().replace(/^#/, "").replace(/^qte/i, "");
  if (!/^\d+$/.test(stripped)) return null;
  const parsed = Number(stripped);
  // Document.number is Postgres INT4 (max 2,147,483,647) -- match the same
  // clamp the existing quotation-history search already applies.
  return parsed <= 2147483647 ? parsed : null;
}

// Extracts the digit prefix typed so far toward a quotation-number lookup --
// e.g. "QTE13" -> "13", "#4" -> "4", "13" -> "13", "QTE" -> "" (prefix started,
// no digits yet), "abc" -> null (not a quotation-number query at all). Unlike
// parseQuotationNumberQuery, this doesn't require a complete number -- it's
// for live, narrowing-as-you-type suggestions the same way product name/SKU
// search already works, not just an exact/complete lookup.
export function extractQuotationNumberPrefix(query: string): string | null {
  const match = /^#?(?:qte)?(\d*)$/i.exec(query.trim());
  return match ? match[1] : null;
}

const INT4_MAX = 2147483647;

// A "starts with these digits" match isn't one contiguous range (e.g. prefix
// "1" matches 1, then 10-19, then 100-199, ... with gaps in between -- 2 and
// 20 don't match), so this returns the set of ranges whose union is exactly
// every integer whose decimal representation starts with `digits`. Used to
// do prefix search against Document.number (a plain Postgres integer, no
// column that supports a text "starts with" match) without raw SQL.
export function quotationNumberPrefixRanges(digits: string): { gte: number; lte: number }[] {
  if (!/^\d+$/.test(digits)) return [];
  const base = Number(digits);
  const ranges: { gte: number; lte: number }[] = [];
  for (let extraDigits = 0; extraDigits <= 9; extraDigits++) {
    const multiplier = 10 ** extraDigits;
    const lo = base * multiplier;
    if (lo > INT4_MAX) break;
    ranges.push({ gte: lo, lte: Math.min(lo + multiplier - 1, INT4_MAX) });
  }
  return ranges;
}
