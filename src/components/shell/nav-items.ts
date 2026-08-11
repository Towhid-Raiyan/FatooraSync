export interface NavItem {
  label: string;
  href: string | null; // null = visually present but not yet clickable ("coming soon")
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "New Receipt", href: "/receipts/new" },
  { label: "New Quotation", href: "/quotations/new" },
  { label: "Products", href: "/products" },
  { label: "Customers", href: "/customers" },
  { label: "Receipt History", href: "/receipts" },
  { label: "Quotation History", href: "/quotations" },
  { label: "Settings", href: "/settings" },
];
