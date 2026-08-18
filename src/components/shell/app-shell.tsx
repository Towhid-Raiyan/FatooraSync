"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { NavDrawer } from "./nav-drawer";

export function AppShell({
  tenantName,
  userEmail,
  role,
  children,
}: {
  tenantName: string;
  userEmail: string;
  role: string;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen">
      <Sidebar tenantName={tenantName} role={role} />
      <NavDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        tenantName={tenantName}
        role={role}
        userEmail={userEmail}
      />

      <div className="relative flex flex-1 flex-col overflow-hidden bg-bg-app">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-primary-mid) 1px, transparent 1px), linear-gradient(90deg, var(--color-primary-mid) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -end-16 -top-24 h-80 w-80 rounded-full bg-accent-mint opacity-[0.18] blur-[60px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -start-10 h-64 w-64 rounded-full bg-accent-mint opacity-[0.18] blur-[60px]"
        />

        <Topbar userEmail={userEmail} onMenuClick={() => setDrawerOpen(true)} />

        <main className="relative z-10 flex-1 overflow-auto p-4 sm:p-5 lg:p-7">{children}</main>
      </div>
    </div>
  );
}
