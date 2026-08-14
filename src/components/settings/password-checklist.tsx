"use client";

import { CheckIcon } from "lucide-react";
import { PASSWORD_RULES } from "@/lib/auth/password-rules";
import { useLocale } from "@/lib/i18n/language-provider";

export function PasswordChecklist({ password }: { password: string }) {
  const { dict } = useLocale();

  return (
    <ul className="flex flex-col gap-1.5">
      {PASSWORD_RULES.map((rule) => {
        const satisfied = rule.test(password);
        return (
          <li key={rule.id} className="flex items-center gap-2 text-xs">
            <span
              className={`flex size-4 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ${
                satisfied ? "scale-110 border-primary bg-primary text-primary-foreground" : "border-input text-transparent"
              }`}
            >
              <CheckIcon className="size-3" />
            </span>
            <span className={satisfied ? "text-heading" : "text-muted-fg"}>{dict.staff.passwordRules[rule.id]}</span>
          </li>
        );
      })}
    </ul>
  );
}
