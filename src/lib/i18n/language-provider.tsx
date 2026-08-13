"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "./locale";
import { getDictionary } from "./get-dictionary";
import type { Dictionary } from "./dictionaries/dictionary.types";

interface LanguageContextValue {
  locale: Locale;
  dict: Dictionary;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      // 1 year, matches this being a durable personal preference rather
      // than a session-scoped value.
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
      setLocaleState(next);
      // Server Components on the current page (nav labels rendered
      // server-side, page titles, etc.) only see the new cookie after a
      // refresh -- Client Components update immediately via the state
      // change above.
      router.refresh();
    },
    [router]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, dict: getDictionary(locale), setLocale }),
    [locale, setLocale]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLocale(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLocale must be used within a LanguageProvider");
  return ctx;
}
