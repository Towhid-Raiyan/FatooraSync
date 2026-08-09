"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";

export function Topbar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const title = NAV_ITEMS.find((item) => item.href === pathname)?.label ?? "FatooraSync";

  return (
    <div className="relative z-10 flex items-center justify-between border-b border-border-subtle bg-white/70 px-7 py-3.5 backdrop-blur-sm">
      <div className="text-[15px] font-bold text-heading">{title}</div>
      <div className="text-[12.5px] text-muted-fg">{userEmail}</div>
    </div>
  );
}
