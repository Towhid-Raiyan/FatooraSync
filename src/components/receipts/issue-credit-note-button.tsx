"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/language-provider";

export function IssueCreditNoteButton({ receiptId }: { receiptId: string }) {
  const { dict } = useLocale();
  return (
    <Button asChild variant="outline" className="mx-auto mt-2 block w-fit print:hidden">
      <Link href={`/receipts/${receiptId}/credit-note`}>{dict.printChrome.issueCreditNote}</Link>
    </Button>
  );
}
