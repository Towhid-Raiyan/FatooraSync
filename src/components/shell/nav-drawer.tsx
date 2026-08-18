"use client";

import { signOut } from "next-auth/react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLocale } from "@/lib/i18n/language-provider";
import { LanguageSwitcher } from "./language-switcher";
import { SidebarBrand, SidebarNav, TenantBadge } from "./sidebar";

interface NavDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantName: string;
  role: string;
  userEmail: string;
}

export function NavDrawer({ open, onOpenChange, tenantName, role, userEmail }: NavDrawerProps) {
  const { dict } = useLocale();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-gradient-to-b from-primary-mid to-primary-dark py-5 text-white">
        <SidebarBrand />
        <SidebarNav role={role} onNavigate={() => onOpenChange(false)} />
        <div className="mt-auto flex flex-col gap-3 border-t border-white/10 px-5 pt-3.5 text-[12.5px] text-white/70">
          <div className="flex items-center justify-between">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => signOut({ redirectTo: "/login" })}
              className="font-medium text-white/85 underline-offset-2 hover:text-white hover:underline"
            >
              {dict.common.signOut}
            </button>
          </div>
          <div className="truncate text-white/50">{userEmail}</div>
        </div>
        <TenantBadge tenantName={tenantName} />
      </SheetContent>
    </Sheet>
  );
}
