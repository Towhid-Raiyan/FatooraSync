import type { Dictionary } from "@/lib/i18n/dictionaries/dictionary.types";

export interface NavItem {
  labelKey: keyof Dictionary["nav"];
  href: string | null; // null = visually present but not yet clickable ("coming soon")
}

export const NAV_ITEMS: NavItem[] = [
  { labelKey: "home", href: "/" },
  { labelKey: "newReceipt", href: "/receipts/new" },
  { labelKey: "newQuotation", href: "/quotations/new" },
  { labelKey: "products", href: "/products" },
  { labelKey: "customers", href: "/customers" },
  { labelKey: "receiptHistory", href: "/receipts" },
  { labelKey: "quotationHistory", href: "/quotations" },
  { labelKey: "settings", href: "/settings" },
];
