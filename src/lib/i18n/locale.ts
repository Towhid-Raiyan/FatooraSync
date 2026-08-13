import { cookies } from "next/headers";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";

export * from "./locale-shared";

import { isLocale, pickLocale, LOCALE_COOKIE, type Locale } from "./locale-shared";

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
