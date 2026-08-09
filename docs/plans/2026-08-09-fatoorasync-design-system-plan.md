# FatooraSync Design System Foundation Implementation Plan

**Execution:** Work through tasks in order, one at a time, with a review checkpoint after each. Checkboxes track progress.

**Goal:** Install the shadcn/ui + Tailwind theme foundation and build the reusable app shell (sidebar + topbar), then apply it to restyle the existing Login and Settings pages and build a real Home dashboard — turning the unstyled Next.js defaults into the approved visual design.

**Architecture:** Tailwind v4 CSS-based theme tokens (Riyadh Green palette, bilingual font pair) define the design language once; shadcn/ui components (owned in-repo, not a dependency) provide accessible primitives; a `(app)` Next.js route group applies a shared `AppShell` layout (sidebar + topbar + soft gradient background) to every authenticated page without repeating it per-page.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui (Radix UI primitives), next/font/google.

## Global Constraints

- Design source of truth: `docs/specs/2026-08-09-fatoorasync-design-system.md` — every exact color, font, and layout value in this plan is copied from there. If anything here seems to conflict with that spec, the spec governs; flag the conflict rather than guessing.
- Primary color `#006C35` (Riyadh Green); accent mint `#6FE3A6`; accent beige `#C9A876`. Full token table in Task 1.
- Typography: Plus Jakarta Sans (Latin) + IBM Plex Sans Arabic (Arabic), both via `next/font/google`. Western numerals even in Arabic text (unaffected by this plan — no Arabic content is rendered yet, but don't introduce Eastern Arabic numerals anywhere).
- The desert background scene (camel, palm trees, mosque skyline, clouds, crescent moon) is **login-only**. The main app (behind the shell) uses a soft gradient-glow background, never the desert scene and never flat white.
- A page's primary actions (Save, Save & Print, etc.) live in exactly one place on the page — never duplicated in both a top bar and a content area.
- **Not in this plan:** full bilingual i18n/RTL routing (`next-intl`, `dir="rtl"` switching) — the design spec's typography section confirms the font pairing works, but wiring actual language switching is separate, future work. Also not in this plan: Products, Customers, Sales Receipt, Quotation pages — those get their own plan next, built on top of this shell. The sidebar links to those sections but they render as visually-present, non-clickable "coming soon" items until that plan ships.
- Dark mode is out of scope — light theme only for now.

---

## File Structure

```
src/
  app/
    globals.css              (modify: theme tokens)
    layout.tsx                (modify: new fonts)
    page.tsx                  (delete: stock content, replaced by (app)/page.tsx)
    login/
      page.tsx                (modify: restyled)
    settings/
      page.tsx                (delete: moved to (app)/settings/page.tsx)
    (app)/
      layout.tsx               (create: AppShell wrapper)
      page.tsx                  (create: Home dashboard)
      settings/
        page.tsx                (create: moved + restyled Settings)
  components/
    desert-scene.tsx          (create)
    shell/
      nav-items.ts             (create)
      sidebar.tsx               (create)
      topbar.tsx                 (create)
      app-shell.tsx               (create)
    ui/                        (create: shadcn-generated — button.tsx, input.tsx, label.tsx, card.tsx)
components.json                (create: shadcn config)
```

---

### Task 1: Tailwind theme tokens, bilingual fonts, and shadcn/ui base components

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `components.json` (via shadcn CLI)
- Create: `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/label.tsx`, `src/components/ui/card.tsx` (via shadcn CLI)
- Create: `src/lib/utils.ts` (via shadcn CLI, provides `cn()` class-merging helper)

**Interfaces:**
- Produces: Tailwind theme tokens usable as utility classes everywhere (`bg-primary`, `text-heading`, `border-subtle`, `font-sans`, `font-arabic`, etc.), and shadcn's `Button`, `Input`, `Label`, `Card`/`CardHeader`/`CardContent` components from `@/components/ui/*`, used by every later task.

- [ ] **Step 1: Initialize shadcn/ui**

```bash
npx shadcn@latest init
```

This detects Tailwind v4 automatically. When prompted, accept the defaults (base color, CSS variables) — the exact generated color values don't matter, Step 2 below replaces them with our real palette. This creates `components.json`, `src/lib/utils.ts`, and adds shadcn's own CSS variable scaffolding to `src/app/globals.css`.

- [ ] **Step 2: Verify the CLI ran correctly**

Run: `cat components.json` (or open it)
Expected: a valid JSON file referencing `src/app/globals.css` as the Tailwind CSS entry and `@/components` as the alias root.

Run: `ls src/lib/utils.ts src/components/ui`
Expected: `utils.ts` exists; `ui/` directory exists (may be empty until Step 4 adds components).

- [ ] **Step 3: Replace the theme tokens with the FatooraSync palette**

Open `src/app/globals.css`. Shadcn's `init` step will have added its own `:root`, `.dark`, and `@theme inline` blocks with placeholder colors — replace the color-related custom properties inside `:root` (keep any shadcn structural/radius variables it added, like `--radius`) with:

```css
:root {
  --background: #FAFBFA;
  --foreground: #233A2C;

  --color-primary: #006C35;
  --color-primary-hover: #007A3D;
  --color-primary-dark: #003D1F;
  --color-accent-mint: #6FE3A6;
  --color-accent-beige: #C9A876;

  --color-heading: #0A3D24;
  --color-body: #3F5C4D;
  --color-muted-fg: #8A968E;
  --color-border-subtle: #E1E8E3;
  --color-bg-app: #FAFBFA;
  --color-bg-card: #FFFFFF;
}
```

Then, inside the `@theme inline` block (or add one if the CLI didn't create it), map these to Tailwind utility names:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--color-primary);
  --color-primary-hover: var(--color-primary-hover);
  --color-primary-dark: var(--color-primary-dark);
  --color-accent-mint: var(--color-accent-mint);
  --color-accent-beige: var(--color-accent-beige);
  --color-heading: var(--color-heading);
  --color-body: var(--color-body);
  --color-muted-fg: var(--color-muted-fg);
  --color-border-subtle: var(--color-border-subtle);
  --color-bg-app: var(--color-bg-app);
  --color-bg-card: var(--color-bg-card);
  --font-sans: var(--font-jakarta), sans-serif;
  --font-arabic: var(--font-ibm-plex-arabic), sans-serif;
}
```

This makes `bg-primary`, `text-heading`, `border-border-subtle`, `font-sans`, `font-arabic`, etc. available as Tailwind utility classes.

**Important — token naming:** the muted-text token is named `--color-muted-fg`, not `--color-muted`. shadcn/ui reserves the exact name `muted` (and `muted-foreground`) for its own internal semantic token, used by `Button`'s `ghost`/`outline` variants and `CardFooter` for hover/background states (see the generated `src/components/ui/button.tsx` and `src/components/ui/card.tsx`). Reusing that exact name would silently override shadcn's own hover-state color with our text-muted color wherever those component variants are used — `muted-fg` avoids the collision while keeping the same design intent (labels, secondary text). Every later task in this plan that references muted/secondary text uses the class `text-muted-fg`, not `text-muted`.

- [ ] **Step 4: Add the bilingual font pair**

Open `src/app/layout.tsx`. Replace the `Geist`/`Geist_Mono` imports and usage with Plus Jakarta Sans and IBM Plex Sans Arabic:

```typescript
import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["500", "600", "700", "800"],
});

const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-ibm-plex-arabic",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "FatooraSync",
  description: "Cloud POS and business management for Saudi SMEs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${plusJakartaSans.variable} ${ibmPlexSansArabic.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

If `IBM_Plex_Sans_Arabic` is not the exact export name in the installed `next/font/google` version (check `node_modules/@next/font/google/index.d.ts` or let TypeScript's autocomplete guide you — Google Fonts sometimes exposes family names with different underscoring), use the correct export name for "IBM Plex Sans Arabic" and note what you found in your report.

- [ ] **Step 5: Install the shadcn components this plan needs**

```bash
npx shadcn@latest add button input label card
```

Expected: creates `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/label.tsx`, `src/components/ui/card.tsx` (card.tsx exports `Card`, `CardHeader`, `CardTitle`, `CardContent` — confirm exact exports by reading the generated file).

- [ ] **Step 6: Verify everything builds**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: succeeds. (The stock `src/app/page.tsx` still exists at this point and will still render — that's fine, Task 6 replaces it.)

- [ ] **Step 7: Commit**

```bash
git add components.json src/app/globals.css src/app/layout.tsx src/lib/utils.ts src/components/ui package.json package-lock.json
git commit -m "Add shadcn/ui and the FatooraSync theme tokens"
```

---

### Task 2: Desert background scene component

**Files:**
- Create: `src/components/desert-scene.tsx`

**Interfaces:**
- Produces: `<DesertScene />` component (no props needed — it's a fixed decorative scene), used by Task 4 (Login page).

- [ ] **Step 1: Create the component**

Create `src/components/desert-scene.tsx`:

```tsx
export function DesertScene() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg viewBox="0 0 1000 400" preserveAspectRatio="xMidYMax slice" className="absolute bottom-0 left-0 h-[62%] w-full">
        <rect x="0" y="370" width="1000" height="6" className="fill-primary opacity-[0.12]" />

        <path
          d="M 900 40 a 32 32 0 1 0 0 64 a 24 24 0 1 1 0 -64 Z"
          className="fill-accent-beige opacity-[0.16]"
        />

        <g className="fill-accent-beige opacity-[0.16]">
          <ellipse cx="120" cy="60" rx="22" ry="8" />
          <ellipse cx="140" cy="55" rx="16" ry="7" />
          <ellipse cx="780" cy="90" rx="18" ry="7" />
          <ellipse cx="798" cy="85" rx="12" ry="6" />
        </g>

        <g className="fill-accent-beige opacity-[0.16]">
          <rect x="640" y="330" width="220" height="40" />
          <path d="M700 330 a20 20 0 0 1 40 0 Z" />
          <rect x="716" y="300" width="8" height="30" />
          <circle cx="720" cy="298" r="5" />
          <path d="M790 330 a14 14 0 0 1 28 0 Z" />
          <path d="M840 330 a10 10 0 0 1 20 0 Z" />
        </g>

        <defs>
          <g id="datepalm-scene">
            <path d="M47 140 C46 110 47 80 49 62 L53 62 C55 80 55 110 55 140 Z" />
            <path d="M51 60 C51 60 30 46 10 46 C10 46 26 62 48 66 Z" />
            <path d="M51 60 C51 60 72 46 92 46 C92 46 76 62 54 66 Z" />
            <path d="M51 58 C51 58 24 34 6 20 C6 20 26 30 46 52 Z" />
            <path d="M51 58 C51 58 78 34 96 20 C96 20 76 30 56 52 Z" />
            <path d="M51 56 C51 56 30 22 22 2 C22 2 38 16 48 46 Z" />
            <path d="M51 56 C51 56 72 22 80 2 C80 2 64 16 54 46 Z" />
            <path d="M51 54 C51 54 44 18 46 0 C46 0 54 4 52 44 Z" />
            <path d="M51 54 C51 54 58 18 56 0 C56 0 48 4 50 44 Z" />
          </g>
        </defs>

        <use href="#datepalm-scene" x="260" y="130" width="130" height="240" className="fill-primary opacity-[0.12]" />
        <use href="#datepalm-scene" x="380" y="180" width="90" height="190" className="fill-primary opacity-[0.12]" />
        <use href="#datepalm-scene" x="470" y="210" width="70" height="160" className="fill-primary opacity-[0.12]" />
        <use href="#datepalm-scene" x="560" y="230" width="60" height="140" className="fill-primary opacity-[0.12]" />
        <use href="#datepalm-scene" x="630" y="240" width="55" height="130" className="fill-primary opacity-[0.12]" />

        <g className="fill-primary opacity-[0.12]" transform="translate(20,150) scale(1.7)">
          <path d="M18 100 C18 92 24 86 30 86 C32 78 40 66 52 62 C50 54 54 44 62 40 C58 32 62 22 72 20 C80 18 88 24 90 32 C96 26 106 26 112 32 C118 26 128 28 132 36 C140 34 148 40 148 48 C156 48 162 56 160 64 C168 66 172 74 168 82 C176 84 180 92 176 100 L176 106 L166 106 L164 96 C160 98 150 98 146 96 L144 106 L134 106 L132 92 C124 96 112 96 104 92 C98 96 88 98 80 94 L78 106 L68 106 L66 94 C58 96 48 94 42 88 L40 106 L28 106 L26 96 C20 96 16 92 18 100 Z M100 36 C96 30 96 22 102 18 C108 14 116 18 118 24 C122 20 128 22 128 28 C128 34 122 36 118 34" />
        </g>
      </svg>
    </div>
  );
}
```

This is a direct port of the approved mockup (`login-final.html`) — same paths, same opacity values, same composition (camel left, five stepped-height palms, small mosque skyline, clouds, crescent moon).

- [ ] **Step 2: Verify it compiles and renders**

Run: `npm run typecheck`
Expected: no errors (JSX attribute names like `viewBox`, `preserveAspectRatio` must be camelCase, which they already are above).

Manually render it in isolation to sanity-check: temporarily add `<DesertScene />` inside a `<div className="relative h-96">` on any existing page, run `npm run dev`, view it in the browser, then remove the temporary usage before committing (Task 4 will add its real usage).

- [ ] **Step 3: Commit**

```bash
git add src/components/desert-scene.tsx
git commit -m "Add the desert background scene component"
```

---

### Task 3: App shell — sidebar, topbar, and the authenticated route group layout

**Files:**
- Create: `src/components/shell/nav-items.ts`
- Create: `src/components/shell/sidebar.tsx`
- Create: `src/components/shell/topbar.tsx`
- Create: `src/components/shell/app-shell.tsx`
- Create: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth/config` (Task 4 of the foundation plan), `prisma` from `@/lib/db/client`
- Produces: `<AppShell tenantName={string} userEmail={string}>{children}</AppShell>` from `@/components/shell/app-shell`, and the `(app)` route group layout that wraps every authenticated page in it. Later tasks (Settings, Home) rely on simply placing their `page.tsx` inside `src/app/(app)/` to get this shell automatically — they do not import `AppShell` themselves.

- [ ] **Step 1: Define the navigation items**

Create `src/components/shell/nav-items.ts`:

```typescript
export interface NavItem {
  label: string;
  href: string | null; // null = visually present but not yet clickable ("coming soon")
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "New Receipt", href: null },
  { label: "Quotations", href: null },
  { label: "Products", href: null },
  { label: "Customers", href: null },
  { label: "History", href: null },
  { label: "Settings", href: "/settings" },
];
```

`href: null` items render disabled — this plan only builds Home and Settings; the rest ship in the next plan.

- [ ] **Step 2: Build the sidebar**

Create `src/components/shell/sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";

export function Sidebar({ tenantName }: { tenantName: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-[220px] shrink-0 flex-col bg-gradient-to-b from-primary-hover to-primary-dark py-5 text-white">
      <div className="mb-3 flex items-center gap-2 border-b border-white/10 px-5 pb-4 font-bold">
        <span className="h-[9px] w-[9px] rounded-full bg-accent-mint" />
        FatooraSync
      </div>

      <nav className="flex flex-col">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href !== null && pathname === item.href;

          if (item.href === null) {
            return (
              <div
                key={item.label}
                className="cursor-not-allowed border-l-[3px] border-transparent px-5 py-2.5 text-sm text-white/35"
                title="Coming soon"
              >
                {item.label}
              </div>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`border-l-[3px] px-5 py-2.5 text-sm transition-colors ${
                isActive
                  ? "border-accent-mint bg-white/10 font-semibold text-white"
                  : "border-transparent text-white/75 hover:bg-white/5 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-2.5 border-t border-white/10 px-5 pt-3.5 text-[12.5px] text-white/70">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-accent-mint text-[11px] font-bold text-primary-dark">
          {tenantName.slice(0, 2).toUpperCase()}
        </span>
        {tenantName}
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Build the topbar**

Create `src/components/shell/topbar.tsx`:

```tsx
export function Topbar({ title, userEmail }: { title: string; userEmail: string }) {
  return (
    <div className="relative z-10 flex items-center justify-between border-b border-border-subtle bg-white/70 px-7 py-3.5 backdrop-blur-sm">
      <div className="text-[15px] font-bold text-heading">{title}</div>
      <div className="text-[12.5px] text-muted-fg">{userEmail}</div>
    </div>
  );
}
```

- [ ] **Step 4: Build the app shell (composes sidebar + topbar + background)**

Create `src/components/shell/app-shell.tsx`:

```tsx
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  tenantName,
  userEmail,
  title,
  children,
}: {
  tenantName: string;
  userEmail: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar tenantName={tenantName} />

      <div className="relative flex flex-1 flex-col overflow-hidden bg-bg-app">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(#045A2C 1px, transparent 1px), linear-gradient(90deg, #045A2C 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-80 w-80 rounded-full bg-accent-mint opacity-[0.18] blur-[60px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-accent-mint opacity-[0.18] blur-[60px]"
        />

        <Topbar title={title} userEmail={userEmail} />

        <main className="relative z-10 flex-1 overflow-auto p-7">{children}</main>
      </div>
    </div>
  );
}
```

Note: `title` is a required prop here, but the layout in Step 5 can't know each page's title. Revise: the layout passes a generic title and individual pages don't override it for this plan's scope (Home and Settings) — set `title="FatooraSync"` in the layout for now; a per-page title mechanism (e.g. via a React context or Next.js's `usePathname`-derived title) is a reasonable follow-up but not required to ship Home and Settings correctly. Keep the `AppShell` component as written (it accepts `title` as a prop) since that's the flexible long-term shape — just pass a static value from the layout for now.

- [ ] **Step 5: Wire up the route group layout**

Create `src/app/(app)/layout.tsx`:

```tsx
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: session!.user.tenantId },
    select: { tradeNameEn: true },
  });

  return (
    <AppShell tenantName={tenant.tradeNameEn} userEmail={session!.user.email ?? ""} title="FatooraSync">
      {children}
    </AppShell>
  );
}
```

This layout applies to every page placed inside `src/app/(app)/` — the `(app)` folder name is a route group and does not appear in the URL, so `src/app/(app)/settings/page.tsx` still serves at `/settings`.

- [ ] **Step 6: Verify it builds**

Run: `npm run typecheck`
Expected: no errors. (There's nothing inside `(app)/` yet to actually render — Tasks 5 and 6 add pages there. This step just confirms the shell components and layout compile.)

- [ ] **Step 7: Commit**

```bash
git add src/components/shell src/app/\(app\)
git commit -m "Add the app shell (sidebar, topbar) and authenticated layout"
```

---

### Task 4: Restyle the Login page

**Files:**
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `<DesertScene />` from `@/components/desert-scene` (Task 2), `Button`/`Input`/`Label` from `@/components/ui/*` (Task 1)

- [ ] **Step 1: Rewrite the login page**

Replace `src/app/login/page.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { DesertScene } from "@/components/desert-scene";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError("Invalid email or password");
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg-app">
      <DesertScene />

      <div className="absolute left-8 top-7 z-10 flex items-center gap-2 text-[15px] font-bold text-heading">
        <span className="h-[9px] w-[9px] animate-pulse rounded-full bg-primary" />
        FatooraSync
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-[340px] rounded-2xl border border-border-subtle bg-white/90 p-8 shadow-[0_1px_2px_rgba(16,44,30,0.04),0_14px_34px_rgba(16,44,30,0.1),0_4px_10px_rgba(16,44,30,0.06)] backdrop-blur-md"
      >
        <h1 className="text-center text-[19px] font-extrabold text-heading">Welcome back</h1>
        <p className="mb-6 text-center text-xs text-muted-fg">Sign in to your business account</p>

        <div className="mb-4">
          <Label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-body">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@yourbusiness.com"
          />
        </div>

        <div className="mb-4">
          <Label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-body">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <Button type="submit" className="w-full bg-gradient-to-br from-primary-hover to-primary-dark">
          Sign In
        </Button>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-fg">
          <span className="h-1 w-1 rounded-full bg-accent-mint" />
          Powered by FatooraSync
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, visit `/login` while logged out.
Expected: the desert scene renders faintly in the background, the card is centered with the frosted-glass effect, the form is fully functional — test signing in with `owner@demo.local` / `changeme123` and confirm it redirects to `/` afterward (the `(app)/page.tsx` from Task 6 needs to exist for that redirect to show something other than a 404 — if Task 6 isn't done yet, confirm the redirect happens correctly even if the destination is still the old page for now).

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "Restyle the login page with the desert background"
```

---

### Task 5: Move and restyle the Settings page into the app shell

**Files:**
- Delete: `src/app/settings/page.tsx`
- Create: `src/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `Button`/`Input`/`Label`/`Card`/`CardHeader`/`CardTitle`/`CardContent` from `@/components/ui/*` (Task 1). Automatically wrapped by the `(app)` layout's `AppShell` (Task 3) — this page does not import `AppShell` itself.

- [ ] **Step 1: Move the file**

```bash
git mv src/app/settings/page.tsx src/app/\(app\)/settings/page.tsx
```

- [ ] **Step 2: Restyle it**

Replace the contents of `src/app/(app)/settings/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const [defaultVatRate, setDefaultVatRate] = useState("15");
  const [language, setLanguage] = useState("ar");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDefaultVatRate(data.defaultVatRate);
        setLanguage(data.language);
      });
  }, []);

  async function handleSave() {
    await fetch("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate, language }),
    });
  }

  return (
    <Card className="max-w-md border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="vat" className="mb-1.5 block text-xs font-semibold text-body">
            Default VAT Rate (%)
          </Label>
          <Input id="vat" value={defaultVatRate} onChange={(e) => setDefaultVatRate(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="lang" className="mb-1.5 block text-xs font-semibold text-body">
            Language
          </Label>
          <select
            id="lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-md border border-border-subtle px-3 py-2 text-sm"
          >
            <option value="ar">Arabic</option>
            <option value="en">English</option>
          </select>
        </div>

        <Button onClick={handleSave} className="bg-gradient-to-br from-primary-hover to-primary-dark">
          Save Changes
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Confirm the existing API route test is unaffected**

Run: `npm test -- settings/route.test.ts`
Expected: still passes — this task only moved/restyled the page component, the `/api/settings` route it calls is untouched.

- [ ] **Step 4: Manually verify in the browser**

Run: `npm run dev`, log in, visit `/settings`.
Expected: renders inside the app shell (sidebar + topbar visible), styled with the new design system, change the VAT rate, save, reload, confirm it persisted (same behavior as before, new appearance).

- [ ] **Step 5: Commit**

`git mv` already staged the rename; the edit from Step 2 needs staging too:

```bash
git add src/app/\(app\)/settings/page.tsx
git commit -m "Move and restyle the settings page into the app shell"
```

---

### Task 6: Home dashboard page

**Files:**
- Delete: `src/app/page.tsx`
- Create: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/client`, `withTenant` from `@/lib/db/tenant-context`, `auth` from `@/lib/auth/config`. Automatically wrapped by the `(app)` layout's `AppShell` (Task 3).

- [ ] **Step 1: Delete the stock homepage**

```bash
git rm src/app/page.tsx
```

- [ ] **Step 2: Create the real Home page**

Create `src/app/(app)/page.tsx`:

```tsx
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";

export default async function HomePage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { tradeNameEn: true },
  });

  const [productCount, customerCount] = await withTenant(tenantId, (tx) =>
    Promise.all([tx.product.count(), tx.customer.count()])
  );

  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-fg">Welcome back</div>
      <h1 className="my-2 bg-gradient-to-br from-primary-hover via-primary to-primary-dark bg-clip-text text-5xl font-extrabold text-transparent">
        {tenant.tradeNameEn}
      </h1>
      <p className="mb-9 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-muted-fg">
        <span className="h-[5px] w-[5px] rounded-full bg-accent-mint" />
        Powered by FatooraSync
      </p>

      <div className="flex gap-4">
        <div className="min-w-[130px] rounded-xl border border-border-subtle bg-white px-6 py-4 shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] transition-transform hover:-translate-y-0.5">
          <div className="text-2xl font-bold text-heading">{productCount}</div>
          <div className="mt-1 text-[11.5px] text-muted-fg">Products</div>
        </div>
        <div className="min-w-[130px] rounded-xl border border-border-subtle bg-white px-6 py-4 shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] transition-transform hover:-translate-y-0.5">
          <div className="text-2xl font-bold text-heading">{customerCount}</div>
          <div className="mt-1 text-[11.5px] text-muted-fg">Customers</div>
        </div>
      </div>
    </div>
  );
}
```

Note: this intentionally omits the "Sales Today" stats and "+ New Sales Receipt" CTA shown in the design mockup — those depend on the Sales Receipt module, which doesn't exist yet (next plan). Showing fabricated numbers or a button linking nowhere would be worse than omitting them; they get added when that module ships.

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, log in.
Expected: redirected to `/`, see the tenant name ("Demo Trading Establishment" or whatever the logged-in demo tenant's `tradeNameEn` is) in large gradient text, "Powered by FatooraSync" beneath it, and two stat cards showing real counts (0 and 0, since no products/customers exist yet — this is correct, not a bug).

- [ ] **Step 4: Commit**

`git rm` already staged the deletion; the new file needs staging too:

```bash
git add src/app/\(app\)/page.tsx
git commit -m "Add the home dashboard page"
```
