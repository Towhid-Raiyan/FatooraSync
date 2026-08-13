"use client";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/language-provider";

export function PrintButton() {
  const { dict } = useLocale();
  return (
    <Button
      type="button"
      variant="primary"
      onClick={() => window.print()}
      className="mx-auto mt-4 block print:hidden"
    >
      {dict.printChrome.print}
    </Button>
  );
}
