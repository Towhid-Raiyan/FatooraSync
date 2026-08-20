"use client";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AdminSidebarBrand, AdminSidebarNav, AdminAccountFooter } from "@/components/admin/admin-sidebar";

interface AdminNavDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  role: string;
  signOutAction: () => Promise<void>;
}

export function AdminNavDrawer({ open, onOpenChange, email, role, signOutAction }: AdminNavDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-white">
        <AdminSidebarBrand />
        <AdminSidebarNav onNavigate={() => onOpenChange(false)} />
        <AdminAccountFooter
          email={email}
          role={role}
          onNavigateSettings={() => onOpenChange(false)}
          signOutAction={signOutAction}
        />
      </SheetContent>
    </Sheet>
  );
}
