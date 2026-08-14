"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/language-provider";

export function BlockedScreen() {
  const { dict } = useLocale();

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-app p-6">
      <Card className="w-full max-w-[420px] border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.04),0_14px_34px_rgba(16,44,30,0.1),0_4px_10px_rgba(16,44,30,0.06)]">
        <CardHeader>
          <CardTitle className="text-heading">{dict.billing.blockedTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-body">{dict.billing.blockedMessage}</p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => signOut({ redirectTo: "/login" })}
          >
            {dict.billing.signOut}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
