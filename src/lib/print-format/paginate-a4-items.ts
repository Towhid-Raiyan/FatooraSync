// How many line items land on each A4 page, for both Receipt and Quotation. Computed
// deliberately, not left to browser/PDF reflow, because the layout rules require
// specific placement: the "Billed To" block only appears on page 1, and the QR/note/
// totals/footer block only appears on the LAST page. These four numbers were derived
// from real row-height/margin math against A4 dimensions -- verify against an actual
// rendered page (browser + PDF) before treating them as final; if real rendering shows
// they're off, they're a one-line constant change here, not a layout rewrite.
export const SINGLE_PAGE_MAX_ITEMS = 12;  // page 1 also carries Billed To + QR/note/totals/footer
export const FIRST_PAGE_MAX_ITEMS = 17;   // multi-page mode: page 1 has Billed To but NOT QR/note/totals
export const MIDDLE_PAGE_MAX_ITEMS = 20;  // no Billed To, no QR/note/totals -- just header + items
export const LAST_PAGE_MAX_ITEMS = 15;    // no Billed To, but DOES carry QR/note/totals/footer

/**
 * Returns an ordered list of item-counts, one entry per page. A page can end up with
 * 0 items (e.g. exactly SINGLE_PAGE_MAX_ITEMS + 1 items -> [15, 0]): item 15 didn't
 * fit within the single-page budget, so a second page exists purely to carry the
 * totals/QR/note/footer block.
 */
export function paginateA4Items(itemCount: number): number[] {
  if (itemCount <= SINGLE_PAGE_MAX_ITEMS) return [itemCount];

  const pages: number[] = [];
  let remaining = itemCount;
  const firstPageCount = Math.min(remaining, FIRST_PAGE_MAX_ITEMS);
  pages.push(firstPageCount);
  remaining -= firstPageCount;

  while (remaining > LAST_PAGE_MAX_ITEMS) {
    const take = Math.min(remaining, MIDDLE_PAGE_MAX_ITEMS);
    pages.push(take);
    remaining -= take;
  }
  pages.push(remaining);
  return pages;
}
