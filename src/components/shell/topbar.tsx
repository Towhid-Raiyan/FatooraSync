"use client";

import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { MenuIcon } from "lucide-react";
import { useLocale } from "@/lib/i18n/language-provider";
import { LanguageSwitcher } from "./language-switcher";
import { NAV_ITEMS } from "./nav-items";

export function Topbar({ userEmail, onMenuClick }: { userEmail: string; onMenuClick: () => void }) {
  const pathname = usePathname();
  const { dict } = useLocale();
  const activeItem = NAV_ITEMS.find((item) => item.href === pathname);
  const title = activeItem ? dict.nav[activeItem.labelKey] : "FatooraSync";

  return (
    <div className="relative z-10 flex items-center justify-between gap-3 border-b border-border-subtle bg-white/70 px-4 py-3 backdrop-blur-sm sm:px-7 sm:py-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={dict.a11y.openMenu}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle text-body xl:hidden"
        >
          <MenuIcon className="size-4" />
        </button>
        <div className="truncate text-[14px] font-bold text-heading sm:text-[15px]">{title}</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden sm:block">
          <LanguageSwitcher />
        </div>
        <div className="hidden text-[12.5px] text-muted-fg md:block">{userEmail}</div>
        <button
          type="button"
          onClick={() => signOut({ redirectTo: "/login" })}
          className="hidden text-[12.5px] font-medium text-muted-fg underline-offset-2 hover:text-heading hover:underline sm:inline"
        >
          {dict.common.signOut}
        </button>
      </div>
    </div>
  );
}
