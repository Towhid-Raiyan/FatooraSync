"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button
      type="button"
      variant="primary"
      onClick={() => window.print()}
      className="mx-auto mt-4 block print:hidden"
    >
      Print
    </Button>
  );
}
