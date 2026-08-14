# Tenant Billing Fields & Access Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the billing/access-control fields to `Tenant` and `Settings`, and the gate that checks them, so a tenant can be put on a trial, marked active, given free (complimentary) access, or suspended — with a suspended/past-due tenant seeing a blocked screen instead of the app.

**Architecture:** A `BillingStatus` enum and two new `Tenant` fields (`billingStatus`, `trialEndsAt`) plus one new `Settings` field (`cashierCanManageCatalog`, reserved for the not-yet-built Owner/Cashier RBAC work). A pure decision function (`isAccessAllowed`) determines whether a given status/trial-date combination is allowed through, called from `(app)/layout.tsx` — the same Server Component layer that already resolves the tenant and the active locale — so a blocked tenant sees a translated "access paused" screen instead of the app shell, on every request, not just at login.

**Tech Stack:** Prisma migration, a pure TypeScript decision function (Vitest), a Client Component blocked-screen wired into the existing i18n dictionary system.

## Global Constraints

- This slice does **not** build the admin panel, Owner/Cashier RBAC, or the `AgencyStaff` model — those are separate, later plans. `billingStatus`/`trialEndsAt`/`featureFlags` are added to the schema now but are only ever set by hand (Prisma Studio / direct SQL) until the admin panel exists; do not build any UI to edit them in this plan.
- `cashierCanManageCatalog` is added to `Settings` now (schema only) but not wired into any permission check or Settings-page UI — there's no Cashier role yet for it to gate. Reserved, matching this project's established pattern of adding forward-looking fields ahead of the feature that consumes them.
- `featureFlags` is added to `Tenant` as a reserved, unused JSON field for the same reason — no code reads it in this plan.
- No data backfill/migration script for the existing demo tenant is needed or should be added: `billingStatus` defaults to `TRIALING` and `trialEndsAt` defaults to `null`, and the access-gate logic (Task 2) treats `TRIALING` with no `trialEndsAt` set as allowed — so every existing and newly-seeded tenant passes the gate with zero extra steps.
- The gate must run in `(app)/layout.tsx` (the Server Component layer), not in `src/middleware.ts` — this repeats an explicit decision from the design spec: middleware can't cheaply re-check the database on every request, and a JWT-embedded status would only refresh on next login.
- New UI text goes through the existing i18n dictionary (`src/lib/i18n/dictionaries/`) — this project translates all app-facing UI, and the blocked screen is no exception.

---

### Task 1: Schema — `BillingStatus` enum, `Tenant`/`Settings` fields, migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `enum BillingStatus { TRIALING ACTIVE COMPLIMENTARY PAST_DUE SUSPENDED }` (Prisma-generated TS type, imported from `@prisma/client` by Task 2)
- Produces: `Tenant.billingStatus: BillingStatus`, `Tenant.trialEndsAt: Date | null`, `Tenant.featureFlags: unknown` (Prisma `Json`)
- Produces: `Settings.cashierCanManageCatalog: boolean`

- [ ] **Step 1: Add the `BillingStatus` enum**

In `prisma/schema.prisma`, add this enum near the other enums at the top of the file (after the existing `enum PrintFormat { ... }` block, before `model Tenant`):

```prisma
enum BillingStatus {
  TRIALING
  ACTIVE
  COMPLIMENTARY
  PAST_DUE
  SUSPENDED
}
```

- [ ] **Step 2: Add the new `Tenant` fields**

In `prisma/schema.prisma`, the `Tenant` model currently reads:

```prisma
model Tenant {
  id                     String   @id @default(uuid())
  legalName              String
  tradeNameEn            String
  tradeNameAr            String?
  vatNumber              String
  crNumber               String?
  address                String?
  phone                  String?
  defaultLocale          String   @default("ar")
  createdAt              DateTime @default(now())
  nextProductSkuNumber   Int      @default(1)
  nextSalesReceiptNumber Int      @default(1)
  nextQuotationNumber    Int      @default(1)
  lastSalesReceiptHash   String?

  users         User[]
  settings      Settings?
  customers     Customer[]
  products      Product[]
  documents     Document[]
  documentLines DocumentLine[]
}
```

Add three fields after `lastSalesReceiptHash` (leave every existing field, including `defaultLocale`, exactly as-is — it is unrelated to this task):

```prisma
model Tenant {
  id                     String        @id @default(uuid())
  legalName              String
  tradeNameEn            String
  tradeNameAr            String?
  vatNumber              String
  crNumber               String?
  address                String?
  phone                  String?
  defaultLocale          String        @default("ar")
  createdAt              DateTime      @default(now())
  nextProductSkuNumber   Int           @default(1)
  nextSalesReceiptNumber Int           @default(1)
  nextQuotationNumber    Int           @default(1)
  lastSalesReceiptHash   String?
  billingStatus          BillingStatus @default(TRIALING)
  trialEndsAt            DateTime?
  featureFlags           Json          @default("{}")

  users         User[]
  settings      Settings?
  customers     Customer[]
  products      Product[]
  documents     Document[]
  documentLines DocumentLine[]
}
```

(Only the column type widths in the alignment changed to keep the block visually aligned per this file's existing style — every field name, type, and default is otherwise exactly as shown.)

- [ ] **Step 3: Add the new `Settings` field**

The `Settings` model currently reads:

```prisma
model Settings {
  id             String      @id @default(uuid())
  tenantId       String      @unique
  tenant         Tenant      @relation(fields: [tenantId], references: [id])
  defaultVatRate Decimal     @default(15.00) @db.Decimal(5, 2)
  language       String      @default("en")
  printFormat    PrintFormat @default(THERMAL)
}
```

Add `cashierCanManageCatalog` after `printFormat`:

```prisma
model Settings {
  id                       String      @id @default(uuid())
  tenantId                 String      @unique
  tenant                   Tenant      @relation(fields: [tenantId], references: [id])
  defaultVatRate           Decimal     @default(15.00) @db.Decimal(5, 2)
  language                 String      @default("en")
  printFormat              PrintFormat @default(THERMAL)
  cashierCanManageCatalog  Boolean     @default(true)
}
```

- [ ] **Step 4: Format, then generate and apply the migration**

Run: `npx prisma format` first — this auto-aligns the schema's column spacing to match the file's existing style, so the exact whitespace in Steps 2-3 above doesn't need to be hand-matched.

Then run: `npx prisma migrate dev --name add_tenant_billing_fields_and_settings_catalog_toggle`
Expected: a new migration directory under `prisma/migrations/` containing an `ALTER TYPE`/`CREATE TYPE` for `BillingStatus` and `ALTER TABLE "Tenant" ADD COLUMN ...` / `ALTER TABLE "Settings" ADD COLUMN ...` statements. This applies cleanly to the existing dev database with no manual data-fix step (see Global Constraints).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors — confirms the regenerated Prisma client's types are consistent with the rest of the codebase.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add Tenant billing fields and Settings catalog-access toggle"
```

---

### Task 2: The access-gate decision function

**Files:**
- Create: `src/lib/billing/access-gate.ts`
- Create: `src/lib/billing/access-gate.test.ts`

**Interfaces:**
- Consumes: `BillingStatus` type from `@prisma/client` (Task 1)
- Produces: `isAccessAllowed(billingStatus: BillingStatus, trialEndsAt: Date | null, now?: Date): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/billing/access-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAccessAllowed } from "./access-gate";

describe("isAccessAllowed", () => {
  it("allows ACTIVE regardless of trialEndsAt", () => {
    expect(isAccessAllowed("ACTIVE", null)).toBe(true);
    expect(isAccessAllowed("ACTIVE", new Date("2000-01-01"))).toBe(true);
  });

  it("allows COMPLIMENTARY regardless of trialEndsAt", () => {
    expect(isAccessAllowed("COMPLIMENTARY", null)).toBe(true);
    expect(isAccessAllowed("COMPLIMENTARY", new Date("2000-01-01"))).toBe(true);
  });

  it("blocks PAST_DUE regardless of trialEndsAt", () => {
    expect(isAccessAllowed("PAST_DUE", null)).toBe(false);
    expect(isAccessAllowed("PAST_DUE", new Date("2999-01-01"))).toBe(false);
  });

  it("blocks SUSPENDED regardless of trialEndsAt", () => {
    expect(isAccessAllowed("SUSPENDED", null)).toBe(false);
    expect(isAccessAllowed("SUSPENDED", new Date("2999-01-01"))).toBe(false);
  });

  it("allows TRIALING with no trialEndsAt set", () => {
    expect(isAccessAllowed("TRIALING", null)).toBe(true);
  });

  it("allows TRIALING when trialEndsAt is in the future", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-01-02T00:00:00Z");
    expect(isAccessAllowed("TRIALING", future, now)).toBe(true);
  });

  it("blocks TRIALING when trialEndsAt is in the past", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const past = new Date("2026-01-01T00:00:00Z");
    expect(isAccessAllowed("TRIALING", past, now)).toBe(false);
  });

  it("blocks TRIALING at the exact trialEndsAt instant", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(isAccessAllowed("TRIALING", now, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `set -a && source .env && set +a && npx vitest run src/lib/billing/access-gate.test.ts`
Expected: FAIL — `Cannot find module './access-gate'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/billing/access-gate.ts`:

```ts
import type { BillingStatus } from "@prisma/client";

// Statuses that are always allowed through, independent of trialEndsAt --
// a paying or complimentary tenant has no expiry to check.
const ALWAYS_ALLOWED = new Set<BillingStatus>(["ACTIVE", "COMPLIMENTARY"]);

/**
 * A tenant with no trialEndsAt set is treated as an open-ended trial, not an
 * expired one -- this is what lets every existing tenant (and every newly
 * seeded one) pass the gate with no manual data-fix step, since nothing
 * before the admin panel exists to actually set a trial end date.
 */
export function isAccessAllowed(
  billingStatus: BillingStatus,
  trialEndsAt: Date | null,
  now: Date = new Date()
): boolean {
  if (ALWAYS_ALLOWED.has(billingStatus)) return true;
  if (billingStatus === "TRIALING") {
    return trialEndsAt === null || trialEndsAt > now;
  }
  return false; // PAST_DUE, SUSPENDED
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `set -a && source .env && set +a && npx vitest run src/lib/billing/access-gate.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing
git commit -m "Add the access-gate decision function"
```

---

### Task 3: Wire the gate into the app layout, with a translated blocked screen

**Files:**
- Create: `src/components/shell/blocked-screen.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/lib/i18n/dictionaries/dictionary.types.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`
- Modify: `src/lib/i18n/dictionaries/ar.ts`

**Interfaces:**
- Consumes: `isAccessAllowed` (Task 2), `useLocale()` from `src/lib/i18n/language-provider.tsx` (already exists)

- [ ] **Step 1: Add the `billing` dictionary group to the type**

In `src/lib/i18n/dictionaries/dictionary.types.ts`, add a new top-level key to the `Dictionary` interface (place it after the existing `printChrome` key):

```ts
  billing: {
    blockedTitle: string;
    blockedMessage: string;
    signOut: string;
  };
```

- [ ] **Step 2: Add the English values**

In `src/lib/i18n/dictionaries/en.ts`, add to the exported `en` object, after the existing `printChrome` property:

```ts
  billing: {
    blockedTitle: "Account access paused",
    blockedMessage: "Your shop's access to FatooraSync is currently paused. Contact us to resolve this and get back to work.",
    signOut: "Sign Out",
  },
```

- [ ] **Step 3: Add the Arabic values**

In `src/lib/i18n/dictionaries/ar.ts`, add to the exported `ar` object, after the existing `printChrome` property:

```ts
  billing: {
    blockedTitle: "تم إيقاف الوصول إلى الحساب",
    blockedMessage: "تم إيقاف وصول متجرك إلى FatooraSync مؤقتاً. تواصل معنا لحل هذا الأمر والعودة إلى العمل.",
    signOut: "تسجيل الخروج",
  },
```

- [ ] **Step 4: Write the blocked-screen component**

Create `src/components/shell/blocked-screen.tsx`:

```tsx
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
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            {dict.billing.signOut}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Wire the gate into the app layout**

Modify `src/app/(app)/layout.tsx`:

```tsx
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { AppShell } from "@/components/shell/app-shell";
import { BlockedScreen } from "@/components/shell/blocked-screen";
import { isAccessAllowed } from "@/lib/billing/access-gate";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: session!.user.tenantId },
    select: { tradeNameEn: true, billingStatus: true, trialEndsAt: true },
  });

  if (!isAccessAllowed(tenant.billingStatus, tenant.trialEndsAt)) {
    return <BlockedScreen />;
  }

  return (
    <AppShell tenantName={tenant.tradeNameEn} userEmail={session!.user.email ?? ""}>
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Run the dictionary parity test**

Run: `set -a && source .env && set +a && npx vitest run src/lib/i18n/dictionaries/dictionary-parity.test.ts`
Expected: PASS — confirms the new `billing` keys were added to both `en.ts` and `ar.ts` with matching shape.

- [ ] **Step 8: Commit**

```bash
git add src/components/shell/blocked-screen.tsx "src/app/(app)/layout.tsx" src/lib/i18n/dictionaries
git commit -m "Wire the access gate into the app layout with a translated blocked screen"
```

---

## Manual Verification (after both tasks land)

Not automatable — run once the branch is otherwise green:

1. Start the dev server, log in as the demo tenant, confirm the app loads normally (demo tenant is `TRIALING` with `trialEndsAt = null`, which the gate allows).
2. Using Prisma Studio or a direct SQL update, set the demo tenant's `billingStatus` to `SUSPENDED`, reload any page under `(app)` — confirm the blocked screen renders instead of the app shell, in both English and Arabic (toggle the language switcher on the blocked screen itself, since `useLocale()` still works there).
3. Click "Sign Out" on the blocked screen — confirm it actually ends the session and redirects to `/login`.
4. Set `billingStatus` back to `TRIALING` (or `ACTIVE`) to restore normal access for further manual testing.
5. Confirm the login page itself is unaffected by any of this — a suspended tenant can still reach `/login` and authenticate; the gate only blocks pages under `(app)`.
