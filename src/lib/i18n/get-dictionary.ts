import type { Locale } from "./locale";
import type { Dictionary } from "./dictionaries/dictionary.types";
import { en } from "./dictionaries/en";
import { ar } from "./dictionaries/ar";

const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
