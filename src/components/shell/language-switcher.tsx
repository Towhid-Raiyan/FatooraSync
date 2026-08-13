"use client";

import { useLocale } from "@/lib/i18n/language-provider";
import type { Locale } from "@/lib/i18n/locale";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  return (
    <select
      aria-label="Language"
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
    >
      <option value="en">English</option>
      <option value="ar">العربية</option>
    </select>
  );
}
