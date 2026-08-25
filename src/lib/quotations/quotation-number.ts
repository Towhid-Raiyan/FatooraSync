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
