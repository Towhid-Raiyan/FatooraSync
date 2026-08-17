"use client";

import { useFormStatus } from "react-dom";
import { Spinner } from "@/components/admin/spinner";

export function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-800 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-70"
    >
      {pending && <Spinner />}
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
