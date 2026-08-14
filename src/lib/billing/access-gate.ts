import type { BillingStatus } from "@prisma/client";

// Statuses that are always allowed through, independent of trialEndsAt --
// a paying or complimentary tenant has no expiry to check.
const ALWAYS_ALLOWED = new Set<BillingStatus>(["ACTIVE", "COMPLIMENTARY"]);

/**
 * A tenant with no trialEndsAt set is treated as an open-ended trial, not an
 * expired one -- this is what lets every existing tenant (and every newly
 * seeded one) pass the gate with no manual data-fix step, since nothing
 * before the admin panel exists to actually set a trial end date.
 */
export function isAccessAllowed(
  billingStatus: BillingStatus,
  trialEndsAt: Date | null,
  now: Date = new Date()
): boolean {
  if (ALWAYS_ALLOWED.has(billingStatus)) return true;
  if (billingStatus === "TRIALING") {
    return trialEndsAt === null || trialEndsAt > now;
  }
  return false; // PAST_DUE, SUSPENDED
}
