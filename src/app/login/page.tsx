"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { DesertScene } from "@/components/desert-scene";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/language-provider";

export default function LoginPage() {
  const { dict } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    setError(null);
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError(dict.login.invalidCredentials);
      setSigningIn(false);
      return;
    }
    // Left signingIn=true deliberately -- the loader stays visible through this
    // full navigation instead of flashing back to idle just before the page unloads.
    window.location.href = "/";
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg-app px-4">
      <DesertScene />

      <div className="absolute start-8 top-7 z-10 flex items-center gap-2 text-[15px] font-bold text-heading">
        <span className="h-[9px] w-[9px] animate-pulse rounded-full bg-primary" />
        FatooraSync
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-[340px] rounded-2xl border border-border-subtle bg-white/90 p-8 shadow-[0_1px_2px_rgba(16,44,30,0.04),0_14px_34px_rgba(16,44,30,0.1),0_4px_10px_rgba(16,44,30,0.06)] backdrop-blur-md"
      >
        <h1 className="text-center text-[19px] font-extrabold text-heading">{dict.login.title}</h1>
        <p className="mb-6 text-center text-xs text-muted-fg">{dict.login.subtitle}</p>

        <div className="mb-4">
          <Label htmlFor="email" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.login.email}
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={dict.login.emailPlaceholder}
          />
        </div>

        <div className="mb-4">
          <Label htmlFor="password" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.login.password}
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p role="alert" className="mb-3 text-xs text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" className="w-full" disabled={signingIn}>
          {signingIn && <Loader2Icon className="size-3.5 animate-spin" />}
          {dict.login.signIn}
        </Button>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-fg">
          <span className="h-1 w-1 rounded-full bg-accent-mint" />
          {dict.common.poweredBy}
        </p>
      </form>
    </div>
  );
}
