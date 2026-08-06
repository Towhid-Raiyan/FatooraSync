const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(identifier) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(identifier, recent);
    return true;
  }

  recent.push(now);
  attempts.set(identifier, recent);
  return false;
}
