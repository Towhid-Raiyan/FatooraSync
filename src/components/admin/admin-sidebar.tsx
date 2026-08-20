"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/admin/sign-out-button";

const NAV_GROUPS = [
  {
    label: "Business",
    items: [
      { href: "/admin", label: "Dashboard" },
      { href: "/admin/tenants", label: "Clients" },
      { href: "/admin/analytics", label: "Analytics", soon: true },
    ],
  },
  {
    label: "Agency",
    items: [
      { href: "/admin/staff", label: "Staff", soon: true },
      { href: "/admin/audit", label: "Audit Log", soon: true },
    ],
  },
];

// Shared between the desktop fixed sidebar and the mobile/tablet drawer so
// the two never drift out of sync -- same links, same active-state logic.
export function AdminSidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  }

  return (
    <>
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mt-3">
          <div className="px-4 pb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">
            {group.label}
          </div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-2 border-s-2 px-4 py-2 text-[13px] font-medium ${
                isActive(item.href)
                  ? "border-green-700 bg-green-50 text-green-950"
                  : "border-transparent text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
              }`}
            >
              {item.label}
              {item.soon && (
                <span className="ms-auto rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] font-bold text-neutral-500">
                  soon
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}

export function AdminSidebarBrand() {
  return (
    <div className="flex items-center gap-2 px-4 py-4 text-[14.5px] font-bold text-neutral-900">
      <span className="size-2 rounded-full bg-green-700" />
      FatooraSync
      <span className="ms-auto rounded border border-neutral-200 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-neutral-500">
        Admin
      </span>
    </div>
  );
}

export function AdminAccountFooter({
  email,
  role,
  onNavigateSettings,
  signOutAction,
}: {
  email: string;
  role: string;
  onNavigateSettings?: () => void;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();

  return (
    <div className="mt-auto border-t border-neutral-200">
      <Link
        href="/admin/settings"
        onClick={onNavigateSettings}
        className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium ${
          pathname.startsWith("/admin/settings")
            ? "bg-green-50 text-green-950"
            : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
        }`}
      >
        Settings
      </Link>
      <div className="flex items-center gap-2.5 border-t border-neutral-200 px-4 py-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-950 text-[11px] font-bold text-white">
          {role === "CTO" ? "CT" : "DV"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-neutral-900">{email}</div>
          <div className="text-[10px] font-bold text-green-800">{role}</div>
        </div>
        <form action={signOutAction}>
          <SignOutButton />
        </form>
      </div>
    </div>
  );
}

// Fixed, always-visible sidebar -- desktop and iPad-landscape-and-wider only
// (xl: 1280px+), matching the tenant-facing app's breakpoint. Below that,
// AdminShell renders AdminNavDrawer instead.
export function AdminSidebar({
  email,
  role,
  signOutAction,
}: {
  email: string;
  role: string;
  signOutAction: () => Promise<void>;
}) {
  return (
    <div className="hidden w-56 shrink-0 flex-col border-e border-neutral-200 bg-white xl:flex">
      <AdminSidebarBrand />
      <AdminSidebarNav />
      <AdminAccountFooter email={email} role={role} signOutAction={signOutAction} />
    </div>
  );
}
