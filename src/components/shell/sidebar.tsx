"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n/language-provider";
import { NAV_ITEMS } from "./nav-items";

export function Sidebar({ tenantName }: { tenantName: string }) {
  const pathname = usePathname();
  const { dict } = useLocale();

  return (
    <aside className="flex w-[220px] shrink-0 flex-col bg-gradient-to-b from-primary-mid to-primary-dark py-5 text-white">
      <div className="mb-3 flex items-center gap-2 border-b border-white/10 px-5 pb-4 font-bold">
        <span className="h-[9px] w-[9px] rounded-full bg-accent-mint" />
        FatooraSync
      </div>

      <nav className="flex flex-col">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href !== null && pathname === item.href;
          const label = dict.nav[item.labelKey];

          if (item.href === null) {
            return (
              <div
                key={item.labelKey}
                className="cursor-not-allowed border-s-[3px] border-transparent px-5 py-2.5 text-sm text-white/35"
                title="Coming soon"
              >
                {label}
              </div>
            );
          }

          return (
            <Link
              key={item.labelKey}
              href={item.href}
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

      <div className="mt-auto flex items-center gap-2.5 border-t border-white/10 px-5 pt-3.5 text-[12.5px] text-white/70">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-accent-mint text-[11px] font-bold text-primary-dark">
          {tenantName.slice(0, 2).toUpperCase()}
        </span>
        {tenantName}
      </div>
    </aside>
  );
}
