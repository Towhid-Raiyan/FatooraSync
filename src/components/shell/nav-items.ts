export interface NavItem {
  label: string;
  href: string | null; // null = visually present but not yet clickable ("coming soon")
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "New Receipt", href: null },
  { label: "Quotations", href: null },
  { label: "Products", href: "/products" },
  { label: "Customers", href: "/customers" },
  { label: "History", href: null },
  { label: "Settings", href: "/settings" },
];
