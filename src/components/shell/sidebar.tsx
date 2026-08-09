"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";

export function Sidebar({ tenantName }: { tenantName: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-[220px] shrink-0 flex-col bg-gradient-to-b from-primary-hover to-primary-dark py-5 text-white">
      <div className="mb-3 flex items-center gap-2 border-b border-white/10 px-5 pb-4 font-bold">
        <span className="h-[9px] w-[9px] rounded-full bg-accent-mint" />
        FatooraSync
      </div>

      <nav className="flex flex-col">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href !== null && pathname === item.href;

          if (item.href === null) {
            return (
              <div
                key={item.label}
                className="cursor-not-allowed border-l-[3px] border-transparent px-5 py-2.5 text-sm text-white/35"
                title="Coming soon"
              >
                {item.label}
              </div>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`border-l-[3px] px-5 py-2.5 text-sm transition-colors ${
                isActive
                  ? "border-accent-mint bg-white/10 font-semibold text-white"
                  : "border-transparent text-white/75 hover:bg-white/5 hover:text-white"
              }`}
            >
              {item.label}
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
