// Deliberately separate from password-rules.ts: an Owner's own password (and
// a tenant's password reset via the agency admin panel) keeps the strict
// 8-char/uppercase/number/special rules there. Cashier accounts the Owner
// creates get a single, much lighter rule -- the Owner is choosing this
// password for someone they already trust to run the till, not protecting
// their own account.
export const MIN_STAFF_PASSWORD_LENGTH = 4;

export function isStaffPasswordValid(password: string): boolean {
  return password.length >= MIN_STAFF_PASSWORD_LENGTH;
}
