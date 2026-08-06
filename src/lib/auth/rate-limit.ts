const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// Full-map sweep on every call - fine at this scale (an in-memory,
// per-instance limiter for a single-owner-per-tenant MVP, not a
// high-throughput system). Without this, `attempts` would grow unbounded
// for the process lifetime if someone sprays failed logins across many
// distinct identifiers.
function pruneExpired(now: number): void {
  for (const [key, timestamps] of attempts) {
    const recent = timestamps.filter((t) => now - t < WINDOW_MS);
    if (recent.length === 0) {
      attempts.delete(key);
    } else {
      attempts.set(key, recent);
    }
  }
}

/**
 * Checks whether `identifier` currently has 5+ failed attempts recorded in
 * the trailing 15-minute window. Does NOT itself record an attempt - callers
 * record failures explicitly via recordFailedAttempt(), and clear the
 * counter on success via resetAttempts(), so that only failed attempts count
 * toward the limit.
 */
export function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  pruneExpired(now);
  const recent = attempts.get(identifier) ?? [];
  return recent.length >= MAX_ATTEMPTS;
}

/** Records a failed attempt for `identifier`. */
export function recordFailedAttempt(identifier: string): void {
  const now = Date.now();
  pruneExpired(now);
  const recent = (attempts.get(identifier) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(identifier, recent);
}

/** Clears any recorded failed attempts for `identifier`, e.g. after a successful login. */
export function resetAttempts(identifier: string): void {
  attempts.delete(identifier);
}
