"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n/language-provider";
import { NAV_ITEMS } from "./nav-items";

// Shared between the desktop fixed sidebar and the mobile/tablet drawer so
// the two never drift out of sync -- same links, same active-state logic,
// same owner-only filtering, rendered in two different shells.
export function SidebarNav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { dict } = useLocale();

  return (
    <nav className="flex flex-col">
      {NAV_ITEMS.filter((item) => !item.ownerOnly || role === "OWNER").map((item) => {
        const isActive = item.href !== null && pathname === item.href;
        const label = dict.nav[item.labelKey];

        if (item.href === null) {
          return (
            <div
              key={item.labelKey}
              className="cursor-not-allowed border-s-[3px] border-transparent px-5 py-2.5 text-sm text-white/35"
              title={dict.a11y.comingSoon}
            >
              {label}
            </div>
          );
        }

        return (
          <Link
            key={item.labelKey}
            href={item.href}
            onClick={onNavigate}
            className={`border-s-[3px] px-5 py-2.5 text-sm transition-colors ${
              isActive
                ? "border-accent-mint bg-white/10 font-semibold text-white"
                : "border-transparent text-white/75 hover:bg-white/5 hover:text-white"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <div className="mb-3 flex items-center gap-2 border-b border-white/10 px-5 pb-4 font-bold">
      <span className="h-[9px] w-[9px] rounded-full bg-accent-mint" />
      FatooraSync
    </div>
  );
}

export function TenantBadge({ tenantName }: { tenantName: string }) {
  return (
    <div className="mt-auto flex items-center gap-2.5 border-t border-white/10 px-5 pt-3.5 text-[12.5px] text-white/70">
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-accent-mint text-[11px] font-bold text-primary-dark">
        {tenantName.slice(0, 2).toUpperCase()}
      </span>
      <span className="truncate">{tenantName}</span>
    </div>
  );
}

// Fixed, always-visible sidebar -- desktop and iPad-landscape-and-wider only
// (xl: 1280px+). Below that, AppShell renders NavDrawer instead: at
// iPad-portrait width (1024px) the sidebar plus the receipt/quotation form's
// desktop grid together leave too little room to feel right, so both switch
// to the compact/drawer treatment together.
export function Sidebar({ tenantName, role }: { tenantName: string; role: string }) {
  return (
    <aside className="hidden w-[220px] shrink-0 flex-col bg-gradient-to-b from-primary-mid to-primary-dark py-5 text-white xl:flex">
      <SidebarBrand />
      <SidebarNav role={role} />
      <TenantBadge tenantName={tenantName} />
    </aside>
  );
}
