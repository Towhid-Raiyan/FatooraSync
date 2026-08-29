// Saudi VAT record-retention baseline is ~6 years. This is informational
// only -- see spec S5: it never blocks deletion, it just tells the CTO
// whether to expect this client's records are still inside that window
// before they confirm. A tenant with no documents at all has nothing to
// retain, so it's never "within" the window.
const RETENTION_YEARS = 6;

export function isWithinRetentionWindow(latestDocumentAt: Date | null): boolean {
  if (!latestDocumentAt) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
  return latestDocumentAt.getTime() >= cutoff.getTime();
}
