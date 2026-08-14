"use client";

import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useLocale } from "@/lib/i18n/language-provider";
import { LanguageSwitcher } from "./language-switcher";
import { NAV_ITEMS } from "./nav-items";

export function Topbar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const { dict } = useLocale();
  const activeItem = NAV_ITEMS.find((item) => item.href === pathname);
  const title = activeItem ? dict.nav[activeItem.labelKey] : "FatooraSync";

  return (
    <div className="relative z-10 flex items-center justify-between border-b border-border-subtle bg-white/70 px-7 py-3.5 backdrop-blur-sm">
      <div className="text-[15px] font-bold text-heading">{title}</div>
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <div className="text-[12.5px] text-muted-fg">{userEmail}</div>
        <button
          type="button"
          onClick={() => signOut({ redirectTo: "/login" })}
          className="text-[12.5px] font-medium text-muted-fg underline-offset-2 hover:text-heading hover:underline"
        >
          {dict.common.signOut}
        </button>
      </div>
    </div>
  );
}
