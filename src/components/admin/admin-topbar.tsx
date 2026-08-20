"use client";

import { MenuIcon } from "lucide-react";

export function AdminTopbar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-neutral-200 bg-white px-4 py-3 xl:hidden">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open menu"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600"
      >
        <MenuIcon className="size-4" />
      </button>
      <div className="flex items-center gap-2 text-[14px] font-bold text-neutral-900">
        <span className="size-2 rounded-full bg-green-700" />
        FatooraSync
        <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-neutral-500">
          Admin
        </span>
      </div>
    </div>
  );
}
