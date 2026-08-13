export type Locale = "en" | "ar";

export const LOCALE_COOKIE = "fs-locale";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "ar";
}

// Pure decision logic, kept separate from the cookies()/session/Prisma I/O
// below so it's directly unit-testable without a request context -- same
// split this codebase already uses elsewhere (e.g. calculate-totals.ts vs.
// the route handlers that call it).
export function pickLocale(
  cookieValue: string | null | undefined,
  tenantDefault: string | null | undefined
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (isLocale(tenantDefault)) return tenantDefault;
  return "en";
}
