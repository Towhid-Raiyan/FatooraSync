import { offlineDb, type StoredNumberLease } from "./db";

type DocumentType = "SALES_RECEIPT" | "QUOTATION";

export async function storeLeasedBlock(documentType: DocumentType, rangeStart: number, rangeEnd: number): Promise<void> {
  await offlineDb.numberLeases.add({ documentType, rangeStart, rangeEnd, nextToIssue: rangeStart });
}

// Draws the next number from the oldest leased block that still has capacity,
// advancing that block's nextToIssue by one. Returns null when every stored
// block for this document type is exhausted. Per spec §4.1, the caller (the
// save flow) then REFUSES the sale with a "reconnect briefly to get more
// numbers" message -- it does not queue it unnumbered. That's the deliberate
// v1 tradeoff: every number a cashier hands a customer is final immediately,
// and the exhaustion case stays rare by construction (blocks of 20, refilled
// at 5 remaining).
export async function issueNumber(documentType: DocumentType): Promise<number | null> {
  return offlineDb.transaction("rw", offlineDb.numberLeases, async () => {
    const blocks = await offlineDb.numberLeases.where("documentType").equals(documentType).sortBy("rangeStart");
    const block = blocks.find((b) => b.nextToIssue <= b.rangeEnd);
    if (!block) return null;
    const issued = block.nextToIssue;
    await offlineDb.numberLeases.update(block.id as number, { nextToIssue: issued + 1 });
    return issued;
  });
}

export async function remainingCapacity(documentType: DocumentType): Promise<number> {
  const blocks = await offlineDb.numberLeases.where("documentType").equals(documentType).toArray();
  return blocks.reduce((sum: number, b: StoredNumberLease) => sum + Math.max(0, b.rangeEnd - b.nextToIssue + 1), 0);
}
