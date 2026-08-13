import { cookies } from "next/headers";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";

export type Locale = "en" | "ar";

export const LOCALE_COOKIE = "fs-locale";

function isLocale(value: string | null | undefined): value is Locale {
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

// Resolution order: the visitor's own cookie, then (if logged in) their
// tenant's Settings.language shop default, then English.
export async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieValue)) return cookieValue;

  const session = await auth();
  if (!session?.user?.tenantId) return "en";

  const settings = await prisma.settings.findUnique({
    where: { tenantId: session.user.tenantId },
    select: { language: true },
  });
  return pickLocale(cookieValue, settings?.language);
}
