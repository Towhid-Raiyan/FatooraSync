"use client";

import { useFormStatus } from "react-dom";
import { Spinner } from "@/components/admin/spinner";

export function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-neutral-400 hover:text-red-600 disabled:opacity-60"
    >
      {pending && <Spinner />}
      Sign out
    </button>
  );
}
