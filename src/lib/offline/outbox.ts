import { offlineDb, type PendingDocument } from "./db";
import { getDeviceId } from "./device-id";

type Kind = "receipt" | "quotation";

function tableFor(kind: Kind) {
  return kind === "receipt" ? offlineDb.pendingReceipts : offlineDb.pendingQuotations;
}

function endpointFor(kind: Kind): string {
  return kind === "receipt" ? "/api/receipts" : "/api/quotations";
}

export async function enqueuePending(kind: Kind, doc: PendingDocument): Promise<void> {
  await tableFor(kind).add(doc);
}

export async function pendingCount(kind: Kind): Promise<number> {
  return tableFor(kind).count();
}

// Replays every queued item against the real save endpoint, in the order it
// was created (Dexie's primary-key insertion order). Each item's `uuid` is
// sent as the request's idempotency key -- the server (Task 4/5) treats a
// resubmission of an already-saved uuid as a no-op, so a request that
// actually succeeded but whose response was lost to a flaky connection can't
// create a duplicate receipt on the next replay.
//
// `authExpired` surfaces the one failure mode that isn't "still offline":
// a 401 means connectivity is fine but the cached session expired while this
// device was away, so no further retry will succeed until the cashier logs
// in again. Task 14's status indicator uses this to show that specific
// message instead of a generic "still syncing" one (spec §7).
export async function replayPending(kind: Kind): Promise<{ synced: number; stillPending: number; authExpired: boolean }> {
  const table = tableFor(kind);
  const items = await table.orderBy("uuid").toArray();
  let synced = 0;
  let stillPending = 0;
  let authExpired = false;

  for (const doc of items) {
    try {
      const response = await fetch(endpointFor(kind), {
        method: "POST",
        headers: { "X-Device-Id": getDeviceId() },
        body: JSON.stringify({
          customer: doc.customer,
          lines: doc.lines,
          notes: doc.notes,
          preAssigned: { number: doc.number, uuid: doc.uuid },
        }),
      });
      if (response.ok) {
        await table.delete(doc.uuid);
        synced++;
      } else {
        stillPending++;
        if (response.status === 401) authExpired = true;
      }
    } catch {
      stillPending++;
    }
  }

  return { synced, stillPending, authExpired };
}
