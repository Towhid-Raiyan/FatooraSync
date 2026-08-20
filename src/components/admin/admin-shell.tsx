"use client";

import { useState } from "react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminNavDrawer } from "@/components/admin/admin-nav-drawer";
import { AdminTopbar } from "@/components/admin/admin-topbar";

export function AdminShell({
  email,
  role,
  signOutAction,
  children,
}: {
  email: string;
  role: string;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div dir="ltr" className="flex min-h-screen bg-neutral-50">
      <AdminSidebar email={email} role={role} signOutAction={signOutAction} />
      <AdminNavDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        email={email}
        role={role}
        signOutAction={signOutAction}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar onMenuClick={() => setDrawerOpen(true)} />
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
