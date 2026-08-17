"use client";

import { useRouter } from "next/navigation";

export function ClickableRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();

  return (
    <tr
      onClick={() => router.push(href)}
      className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
    >
      {children}
    </tr>
  );
}
