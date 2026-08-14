"use client";

import { Toast as ToastPrimitive } from "radix-ui";
import { CheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n/language-provider";

export interface ToastMessage {
  id: string;
  type: "success" | "error";
  message: string;
}

export function ToastViewport({
  toasts,
  onRemove,
}: {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}) {
  const { dict } = useLocale();

  return (
    <ToastPrimitive.Provider swipeDirection="left" duration={4000}>
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          className={cn(
            "flex items-start gap-2.5 rounded-xl border bg-bg-card p-3.5 pe-3 shadow-[0_4px_16px_rgba(16,44,30,0.12)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[swipe=end]:animate-out",
            t.type === "success" ? "border-accent-mint/40" : "border-red-200"
          )}
          onOpenChange={(open) => {
            if (!open) onRemove(t.id);
          }}
        >
          {t.type === "success" ? (
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : (
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-red-600" />
          )}
          <ToastPrimitive.Title className="flex-1 text-sm text-heading">{t.message}</ToastPrimitive.Title>
          <ToastPrimitive.Close aria-label={dict.a11y.close} className="text-muted-fg hover:text-heading">
            <XIcon className="size-3.5" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed top-4 end-4 z-[100] flex w-full max-w-sm flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
