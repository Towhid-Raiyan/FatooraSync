import { createHash } from "crypto";

// Fixed genesis value: a tenant's first-ever sales receipt has no prior receipt
// to chain from.
export const GENESIS_HASH = "0";

export interface HashChainInput {
  previousInvoiceHash: string | null;
  uuid: string;
  grandTotal: string;
  vatTotal: string;
  createdAt: string; // ISO 8601
}

// Phase-1 ZATCA readiness, not real cryptographic signing (that's Phase 2, which
// needs live ZATCA onboarding -- out of MVP scope). Deterministic SHA-256 over the
// receipt's core fields, chained to the previous receipt's hash, so a later
// cryptographic replacement doesn't need to restructure historical records.
export function computeInvoiceHash(input: HashChainInput): string {
  const previous = input.previousInvoiceHash ?? GENESIS_HASH;
  const payload = `${previous}${input.uuid}${input.grandTotal}${input.vatTotal}${input.createdAt}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
