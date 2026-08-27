import { offlineDb, type StoredNumberLease } from "./db";

type DocumentType = "SALES_RECEIPT" | "QUOTATION";

export async function storeLeasedBlock(documentType: DocumentType, rangeStart: number, rangeEnd: number): Promise<void> {
  await offlineDb.numberLeases.add({ documentType, rangeStart, rangeEnd, nextToIssue: rangeStart });
}

// Draws the next number from the oldest leased block that still has capacity,
// advancing that block's nextToIssue by one. Returns null when every stored
// block for this document type is exhausted -- the caller (the save flow,
// Task 13) is responsible for queueing without a final number in that rare
// case, per spec §4.1.
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
