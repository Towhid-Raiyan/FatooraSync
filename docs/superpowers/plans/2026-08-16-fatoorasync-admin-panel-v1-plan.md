# FatooraSync Agency Admin Panel v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-editing the database for client onboarding with a real admin panel — agency staff can create tenants and manage their billing status from `/admin`, with everything they do written to an audit trail.

**Architecture:** A second, fully independent Auth.js v5 instance (`AgencyStaff`, own cookie, own basePath) guards a new `/admin` URL prefix. Two new Prisma models (`AgencyStaff`, `AuditLog`) live outside the `withTenant()` isolation layer and are queried with the raw Prisma client. The admin UI is a plain, unbranded sidebar shell (no `DesertScene`, no shared components with the tenant app) reusing existing shadcn/ui primitives.

**Tech Stack:** Next.js 15 App Router, Auth.js v5 (`next-auth@5.0.0-beta.32`), Prisma, Vitest, existing `argon2` password hashing.

**Spec:** [docs/superpowers/specs/2026-08-16-fatoorasync-admin-panel-v1-design.md](../specs/2026-08-16-fatoorasync-admin-panel-v1-design.md)

## Global Constraints

- `AgencyStaff` and `AuditLog` must **never** be added to `TENANT_SCOPED_MODELS` in `src/lib/db/tenant-context.ts:3`. Every admin-panel query uses the raw `prisma` client from `@/lib/db/client`, not `withTenant()`.
- Admin authentication is checked in `src/app/admin/(protected)/layout.tsx`, never in `src/middleware.ts`. Middleware only excludes `/admin` and `/api/admin-auth` from the *tenant* session redirect.
- Tenant creation and billing/feature-flag edits require `AgencyStaffRole.CTO`. Read-only tenant list/detail is open to any `AgencyStaff` (`CTO` or `DEVELOPER`).
- Every sensitive admin action (tenant creation, billing-status change) writes an `AuditLog` row in the same request.
- Admin panel UI is plain and internal-tool styled: shadcn/ui primitives, brand green (`#006C35`, Tailwind-available as the existing `primary` token) as an accent only. No `DesertScene`, no i18n dictionary usage (admin is English-only for v1 — it's an internal tool, never shown to a tenant), no shared layout component with the tenant app's `AppShell`.
- `AgencyStaff.email` matching is case-insensitive via consistent lowercasing on both the seed script and `authorize()` — never add normalization to only one side.
- `trialEndsAt` on tenant creation defaults to 14 days from creation.
- `PAST_DUE` status renders as solid red (`text-red-600` / `bg-red-50`); `SUSPENDED` renders as a darker red (`text-red-800` / `bg-red-100`) — the two must be visually distinguishable, not identical.
- Admin pages force `dir="ltr"` on their root wrapper regardless of the tenant-side locale cookie the root layout reads (`src/app/layout.tsx` sets `dir` on `<html>` from a cookie that has nothing to do with the agency's own language preference).

---

### Task 1: Schema — `AgencyStaff`, `AuditLog`, and extending `seedTenant()`

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/db/seed-tenant.ts`
- Modify: `src/lib/db/seed-tenant.test.ts`
- Create: migration (via `prisma migrate dev`)

**Interfaces:**
- Produces: `AgencyStaffRole` enum (`CTO | DEVELOPER`), `AgencyStaff` model, `AuditLog` model — used by every later task.
- Produces: `SeedTenantInput` gains `crNumber?: string`, `phone?: string`, `address?: string`. `SeedTenantResult["tenant"]` gains `trialEndsAt: Date`.

- [ ] **Step 1: Add the two new models to the schema**

Open `prisma/schema.prisma`. Add this enum near the existing enums (after `UserRole`, around line 40):

```prisma
enum AgencyStaffRole {
  CTO
  DEVELOPER
}
```

Add these two models after the `Session` model at the end of the file:

```prisma
model AgencyStaff {
  id           String          @id @default(uuid())
  email        String          @unique
  passwordHash String
  role         AgencyStaffRole @default(DEVELOPER)
  createdAt    DateTime        @default(now())

  auditLogs AuditLog[]
}

model AuditLog {
  id            String      @id @default(uuid())
  agencyStaffId String
  agencyStaff   AgencyStaff @relation(fields: [agencyStaffId], references: [id])
  action        String
  tenantId      String?
  metadata      Json        @default("{}")
  createdAt     DateTime    @default(now())
}
```

Do **not** add `"AgencyStaff"` or `"AuditLog"` to `TENANT_SCOPED_MODELS` in `src/lib/db/tenant-context.ts` — they are deliberately outside that isolation layer.

- [ ] **Step 2: Generate and run the migration**

```bash
set -a && source .env && set +a && npx prisma migrate dev --name add_agency_staff_and_audit_log
```

Expected: a new folder under `prisma/migrations/` containing the `CREATE TYPE "AgencyStaffRole"`, `CREATE TABLE "AgencyStaff"`, and `CREATE TABLE "AuditLog"` statements, and the command exits 0.

- [ ] **Step 3: Regenerate the Prisma client**

```bash
set -a && source .env && set +a && npx prisma generate
```

- [ ] **Step 4: Write the failing test for the extended `seedTenant()`**

Open `src/lib/db/seed-tenant.test.ts`. Add a new test after the existing one:

```ts
  it(
    "accepts optional crNumber, phone, and address, and sets a 14-day trial",
    { timeout: 30000 },
    async () => {
      const uniqueId = Date.now();
      const before = Date.now();
      const result = await seedTenant({
        legalName: "Seed Test Co 2",
        tradeNameEn: "Seed Test Shop 2",
        vatNumber: "300000000000006",
        ownerEmail: `seedowner2+${uniqueId}@example.com`,
        ownerPassword: "seedpassword123",
        crNumber: "1010101010",
        phone: "0500000000",
        address: "123 Test Street, Riyadh",
      });

      try {
        expect(result.tenant.crNumber).toBe("1010101010");
        expect(result.tenant.phone).toBe("0500000000");
        expect(result.tenant.address).toBe("123 Test Street, Riyadh");
        expect(result.tenant.trialEndsAt).not.toBeNull();
        const trialEndsAtMs = result.tenant.trialEndsAt!.getTime();
        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
        // Allow a generous window either side of "before + 14 days" to absorb
        // test execution time - the exact millisecond isn't the point, the
        // 14-day offset is.
        expect(trialEndsAtMs).toBeGreaterThan(before + fourteenDaysMs - 60_000);
        expect(trialEndsAtMs).toBeLessThan(before + fourteenDaysMs + 60_000);
      } finally {
        await prisma.customer.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.settings.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.user.deleteMany({ where: { tenantId: result.tenant.id } });
        await prisma.tenant.delete({ where: { id: result.tenant.id } });
      }
    }
  );
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
set -a && source .env && set +a && npx vitest run src/lib/db/seed-tenant.test.ts
```

Expected: FAIL — `crNumber`/`phone`/`address` aren't accepted by `SeedTenantInput` yet (TypeScript error) and `trialEndsAt` isn't set.

- [ ] **Step 6: Extend `seed-tenant.ts`**

Replace the full contents of `src/lib/db/seed-tenant.ts` with:

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { hashPassword } from "@/lib/auth/password";

const TRIAL_LENGTH_MS = 14 * 24 * 60 * 60 * 1000;

export interface SeedTenantInput {
  legalName: string;
  tradeNameEn: string;
  tradeNameAr?: string;
  vatNumber: string;
  crNumber?: string;
  phone?: string;
  address?: string;
  ownerEmail: string;
  ownerPassword: string;
}

export interface SeedTenantResult {
  tenant: {
    id: string;
    legalName: string;
    tradeNameEn: string;
    tradeNameAr: string | null;
    vatNumber: string;
    crNumber: string | null;
    phone: string | null;
    address: string | null;
    trialEndsAt: Date | null;
  };
  user: { id: string; tenantId: string; email: string; passwordHash: string };
  settings: { tenantId: string; defaultVatRate: Prisma.Decimal };
  walkInCustomer: { id: string; tenantId: string; name: string; isWalkIn: boolean };
}

export async function seedTenant(input: SeedTenantInput): Promise<SeedTenantResult> {
  // Uses raw prisma.$transaction instead of withTenant() because this is a bootstrap
  // operation creating a new tenant; withTenant() scopes queries to an *existing* tenant.
  // Each create() call explicitly sets the correct tenantId, so there is no cross-tenant risk.
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        legalName: input.legalName,
        tradeNameEn: input.tradeNameEn,
        tradeNameAr: input.tradeNameAr,
        vatNumber: input.vatNumber,
        crNumber: input.crNumber,
        phone: input.phone,
        address: input.address,
        trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_MS),
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: input.ownerEmail,
        passwordHash: await hashPassword(input.ownerPassword),
      },
    });

    const settings = await tx.settings.create({
      data: { tenantId: tenant.id },
    });

    const walkInCustomer = await tx.customer.create({
      data: { tenantId: tenant.id, name: "Walk-in Customer", isWalkIn: true },
    });

    return { tenant, user, settings, walkInCustomer };
  });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
set -a && source .env && set +a && npx vitest run src/lib/db/seed-tenant.test.ts
```

Expected: PASS, both tests.

- [ ] **Step 8: Typecheck**

```bash
set -a && source .env && set +a && npx tsc --noEmit
```

Expected: clean (the existing `prisma/seed.ts` call site only passes the original fields, all still valid since the new ones are optional).

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/db/seed-tenant.ts src/lib/db/seed-tenant.test.ts
git commit -m "Add AgencyStaff and AuditLog models, extend seedTenant with CR/phone/address and a 14-day trial"
```

---

### Task 2: Admin auth — config, route handler, middleware, guards, first-CTO seed script

**Files:**
- Create: `src/lib/admin-auth/config.ts`
- Create: `src/lib/admin-auth/config.test.ts`
- Create: `src/lib/admin-auth/get-admin-session.ts`
- Create: `src/lib/admin-auth/require-cto.ts`
- Create: `src/lib/admin-auth/require-cto.test.ts`
- Create: `src/lib/admin-auth/audit-actions.ts`
- Create: `src/lib/admin-auth/audit-log.ts`
- Create: `src/app/api/admin-auth/[...nextauth]/route.ts`
- Modify: `src/middleware.ts`
- Create: `prisma/seed-agency-staff.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` from `@/lib/auth/password`, `isRateLimited`/`recordFailedAttempt`/`resetAttempts` from `@/lib/auth/rate-limit`, `prisma` from `@/lib/db/client`, `AgencyStaffRole`/`AgencyStaff`/`AuditLog` from Task 1.
- Produces: `authorize()`, `handlers`, `auth`, `signIn`, `signOut` from `src/lib/admin-auth/config.ts` (mirrors the tenant `src/lib/auth/config.ts` shape). `getAdminSession(): Promise<{ user: AdminSessionUser } | null>` and `AdminSessionUser { agencyStaffId: string; role: "CTO" | "DEVELOPER" }` from `get-admin-session.ts` — **every later task that needs the current agency staff member's identity uses this function, not `auth()` directly** (see Step 2 for why). `assertCtoRole(role: string | undefined): NextResponse | null` from `require-cto.ts`. `AUDIT_ACTIONS.TENANT_CREATED` / `AUDIT_ACTIONS.BILLING_STATUS_CHANGED` (both `string`) from `audit-actions.ts`. `writeAuditLog(input: { agencyStaffId: string; action: string; tenantId?: string; metadata?: object }): Promise<void>` from `audit-log.ts`.

- [ ] **Step 1: Add the audit-action constants**

Create `src/lib/admin-auth/audit-actions.ts`:

```ts
export const AUDIT_ACTIONS = {
  TENANT_CREATED: "TENANT_CREATED",
  BILLING_STATUS_CHANGED: "BILLING_STATUS_CHANGED",
} as const;
```

- [ ] **Step 2: Add the audit-log write helper**

Create `src/lib/admin-auth/audit-log.ts`:

```ts
import { prisma } from "@/lib/db/client";

export async function writeAuditLog(input: {
  agencyStaffId: string;
  action: string;
  tenantId?: string;
  metadata?: object;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      agencyStaffId: input.agencyStaffId,
      action: input.action,
      tenantId: input.tenantId,
      metadata: input.metadata ?? {},
    },
  });
}
```

- [ ] **Step 3: Write the admin auth config**

Create `src/lib/admin-auth/config.ts`. This mirrors `src/lib/auth/config.ts`'s shape (Credentials provider, rate-limited `authorize()`, `argon2`-backed password check), with three deliberate differences: a distinct `basePath` and cookie name so the two sessions can never collide, a JWT payload carrying `agencyStaffId`/`role` instead of `tenantId`/`role`, and case-insensitive email matching (§4 of the spec: consistent lowercasing on both this file and the seed script, not the tenant `User` path's "no normalization" fix — different problem, different correct answer).

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";
import { isRateLimited, recordFailedAttempt, resetAttempts } from "@/lib/auth/rate-limit";

function clientIp(request: Request): string | undefined {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? undefined;
}

export async function authorize(credentials: { email: string; password: string }, ip?: string) {
  const email = credentials.email.trim().toLowerCase();
  const rateLimitKey = ip ? `admin:${email}:${ip}` : `admin:${email}`;

  if (isRateLimited(rateLimitKey)) return null;

  const staff = await prisma.agencyStaff.findUnique({ where: { email } });
  if (!staff) {
    recordFailedAttempt(rateLimitKey);
    return null;
  }

  const valid = await verifyPassword(credentials.password, staff.passwordHash);
  if (!valid) {
    recordFailedAttempt(rateLimitKey);
    return null;
  }

  resetAttempts(rateLimitKey);
  return { id: staff.id, email: staff.email, agencyStaffId: staff.id, role: staff.role };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: "/api/admin-auth",
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 },
  cookies: {
    sessionToken: {
      name: "admin-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: (credentials, request) =>
        authorize(
          { email: credentials.email as string, password: credentials.password as string },
          clientIp(request)
        ),
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        const typedUser = user as { agencyStaffId: string; role: string };
        token.agencyStaffId = typedUser.agencyStaffId;
        token.role = typedUser.role;
      }
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, agencyStaffId: token.agencyStaffId as string, role: token.role as string },
    }),
  },
});
```

No edge-safe split is needed here (unlike `src/lib/auth/auth.config.ts` / `config.ts`): this config is never imported from `src/middleware.ts` (admin auth is checked from a Server Component layout in Task 4, which runs in the Node.js runtime), so bundling `argon2` here is never a problem.

- [ ] **Step 4: Add the typed session-reader wrapper**

TypeScript problem to solve first: the tenant app's `src/lib/auth/next-auth.d.ts` globally augments `next-auth`'s `Session.user` type with `{ tenantId, role }`. That augmentation is global to the whole `next-auth` package import, not scoped to one `NextAuth()` instance — so adding a *second* `declare module "next-auth"` block for `{ agencyStaffId, role }` would just get merged into the same global type by TypeScript, muddying both. Don't touch `next-auth.d.ts`. Instead, every consumer of the admin session goes through one small typed wrapper that casts once, in one place:

Create `src/lib/admin-auth/get-admin-session.ts`:

```ts
import { auth } from "./config";

export interface AdminSessionUser {
  agencyStaffId: string;
  role: "CTO" | "DEVELOPER";
}

export async function getAdminSession(): Promise<{ user: AdminSessionUser } | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { user: session.user as unknown as AdminSessionUser };
}
```

- [ ] **Step 5: Add the route handler**

Create `src/app/api/admin-auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/lib/admin-auth/config";

export const { GET, POST } = handlers;
```

- [ ] **Step 6: Exclude `/admin` from the tenant middleware's redirect**

Open `src/middleware.ts`. It currently reads:

```ts
export default auth((req) => {
  const isPublic = req.nextUrl.pathname.startsWith("/login") || req.nextUrl.pathname.startsWith("/api/auth");
  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
});
```

Change the `isPublic` line to:

```ts
export default auth((req) => {
  const isPublic =
    req.nextUrl.pathname.startsWith("/login") ||
    req.nextUrl.pathname.startsWith("/api/auth") ||
    req.nextUrl.pathname.startsWith("/admin") ||
    req.nextUrl.pathname.startsWith("/api/admin-auth");
  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
});
```

`/admin/*` now skips the *tenant* session check entirely — its own auth is enforced in Task 4's `src/app/admin/(protected)/layout.tsx`, not here.

- [ ] **Step 7: Write the failing test for the admin `authorize()`**

Create `src/lib/admin-auth/config.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { authorize } from "./config";

describe("admin credentials authorize", () => {
  beforeAll(async () => {
    await prisma.agencyStaff.create({
      data: {
        email: "cto@fatoorasync.sa",
        passwordHash: await hashPassword("supersecret123"),
        role: "CTO",
      },
    });
  });

  afterAll(async () => {
    await prisma.agencyStaff.deleteMany({ where: { email: "cto@fatoorasync.sa" } });
    await prisma.$disconnect();
  });

  it("returns the staff member for valid credentials", async () => {
    const staff = await authorize({ email: "cto@fatoorasync.sa", password: "supersecret123" });
    expect(staff).not.toBeNull();
    expect(staff?.role).toBe("CTO");
  });

  it("matches email case-insensitively", async () => {
    const staff = await authorize({ email: "CTO@FatooraSync.SA", password: "supersecret123" });
    expect(staff).not.toBeNull();
    expect(staff?.email).toBe("cto@fatoorasync.sa");
  });

  it("returns null for an invalid password", async () => {
    const staff = await authorize({ email: "cto@fatoorasync.sa", password: "wrong" });
    expect(staff).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    const staff = await authorize({ email: "nobody@fatoorasync.sa", password: "whatever" });
    expect(staff).toBeNull();
  });

  it("returns null once the rate limit is exceeded for an identifier", async () => {
    const email = "rate-limited-admin@fatoorasync.sa";
    for (let i = 0; i < 5; i++) {
      await authorize({ email, password: "whatever" });
    }
    const staff = await authorize({ email, password: "whatever" });
    expect(staff).toBeNull();
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

```bash
set -a && source .env && set +a && npx vitest run src/lib/admin-auth/config.test.ts
```

Expected: FAIL — `prisma.agencyStaff` doesn't exist yet until Task 1's migration has run (it has), and `authorize` isn't exported yet from a file that doesn't exist.

- [ ] **Step 9: Run the test to verify it passes**

```bash
set -a && source .env && set +a && npx vitest run src/lib/admin-auth/config.test.ts
```

Expected: PASS, all 5 tests (Step 3's `config.ts` already implements everything needed).

- [ ] **Step 10: Write the CTO role guard**

Create `src/lib/admin-auth/require-cto.ts`, mirroring `src/lib/rbac/require-owner.ts`:

```ts
import { NextResponse } from "next/server";

export function assertCtoRole(role: string | undefined): NextResponse | null {
  if (role !== "CTO") {
    return NextResponse.json({ error: "Only the CTO can do this" }, { status: 403 });
  }
  return null;
}
```

Create `src/lib/admin-auth/require-cto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertCtoRole } from "./require-cto";

describe("assertCtoRole", () => {
  it("returns null for a CTO", () => {
    expect(assertCtoRole("CTO")).toBeNull();
  });

  it("returns a 403 response for a Developer", async () => {
    const response = assertCtoRole("DEVELOPER");
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it("returns a 403 response for an undefined role", async () => {
    const response = assertCtoRole(undefined);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });
});
```

- [ ] **Step 11: Run the guard test**

```bash
set -a && source .env && set +a && npx vitest run src/lib/admin-auth/require-cto.test.ts
```

Expected: PASS, all 3 tests.

- [ ] **Step 12: Write the first-CTO seed script**

Create `prisma/seed-agency-staff.ts`:

```ts
import { prisma } from "../src/lib/db/client";
import { hashPassword } from "../src/lib/auth/password";

// One-time bootstrap: run this once against production to create the first
// CTO account. There is no UI to create AgencyStaff rows in v1 (staff
// management is explicitly deferred - see the admin panel v1 spec, §2) so
// this script is the only way one gets created until that ships. Edit the
// email/password below before running, the same way prisma/seed.ts's demo
// credentials are edited by hand for a real run.
async function main() {
  const email = "cto@fatoorasync.sa".toLowerCase();
  const password = "changeme123";

  const existing = await prisma.agencyStaff.findUnique({ where: { email } });
  if (existing) {
    console.log(`AgencyStaff with email ${email} already exists (id ${existing.id}) - not creating a duplicate.`);
    return;
  }

  const staff = await prisma.agencyStaff.create({
    data: { email, passwordHash: await hashPassword(password), role: "CTO" },
  });
  console.log(`Created CTO account ${staff.email} (id ${staff.id}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 13: Run the script against the dev database and verify manually**

```bash
set -a && source .env && set +a && npx tsx prisma/seed-agency-staff.ts
```

Expected: `Created CTO account cto@fatoorasync.sa (id ...).` printed. Run it a second time to confirm the duplicate-guard message appears instead of a unique-constraint crash.

- [ ] **Step 14: Typecheck and lint**

```bash
set -a && source .env && set +a && npx tsc --noEmit
npm run lint
```

Expected: both clean.

- [ ] **Step 15: Commit**

```bash
git add src/lib/admin-auth src/app/api/admin-auth src/middleware.ts prisma/seed-agency-staff.ts
git commit -m "Add AgencyStaff authentication: config, route handler, CTO guard, first-CTO seed script"
```

---

### Task 3: Admin tenant API routes

**Files:**
- Create: `src/app/api/admin/tenants/route.ts`
- Create: `src/app/api/admin/tenants/route.test.ts`
- Create: `src/app/api/admin/tenants/[id]/route.ts`
- Create: `src/app/api/admin/tenants/[id]/route.test.ts`
- Create: `src/app/api/admin/tenants/[id]/billing/route.ts`
- Create: `src/app/api/admin/tenants/[id]/billing/route.test.ts`

**Interfaces:**
- Consumes: `getAdminSession`, `assertCtoRole`, `AUDIT_ACTIONS`, `writeAuditLog` from Task 2; `seedTenant` from Task 1; `prisma` from `@/lib/db/client`.
- Produces: `GET /api/admin/tenants?q=<search>` → `{ tenants: TenantListItem[] }`. `POST /api/admin/tenants` → `201 { id, tradeNameEn, ... }` or `400`/`403`/`409`. `GET /api/admin/tenants/[id]` → tenant detail JSON or `404`. `PATCH /api/admin/tenants/[id]/billing` → updated tenant JSON or `400`/`403`/`404`. These exact shapes are what Tasks 5-7's UI fetches against.

- [ ] **Step 1: Write the failing tests for the list+create route**

Create `src/app/api/admin/tenants/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { GET, POST } from "./route";

let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

let ctoId: string;
let developerId: string;
const createdTenantIds: string[] = [];

describe("/api/admin/tenants", () => {
  beforeAll(async () => {
    const cto = await prisma.agencyStaff.create({
      data: { email: "route-test-cto@fatoorasync.sa", passwordHash: await hashPassword("x"), role: "CTO" },
    });
    ctoId = cto.id;
    const developer = await prisma.agencyStaff.create({
      data: { email: "route-test-dev@fatoorasync.sa", passwordHash: await hashPassword("x"), role: "DEVELOPER" },
    });
    developerId = developer.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyStaffId: { in: [ctoId, developerId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: createdTenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
    await prisma.agencyStaff.deleteMany({ where: { id: { in: [ctoId, developerId] } } });
    await prisma.$disconnect();
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET(new Request("http://localhost/api/admin/tenants"));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("creates a tenant as CTO and writes an audit log entry", async () => {
    const uniqueId = Date.now();
    const response = await POST(
      new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({
          legalName: "Route Test Trading Co",
          tradeNameEn: "Route Test Shop",
          vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
          ownerEmail: `routetest+${uniqueId}@example.com`,
          ownerPassword: "RoutePass123!",
        }),
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.tradeNameEn).toBe("Route Test Shop");
    createdTenantIds.push(body.id);

    const auditRows = await prisma.auditLog.findMany({ where: { tenantId: body.id } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("TENANT_CREATED");
    expect(auditRows[0].agencyStaffId).toBe(ctoId);
  });

  it("returns 403 when a Developer tries to create a tenant", async () => {
    mockSession = { user: { agencyStaffId: developerId, role: "DEVELOPER" } };
    try {
      const response = await POST(
        new Request("http://localhost/api/admin/tenants", {
          method: "POST",
          body: JSON.stringify({
            legalName: "Should Not Exist",
            tradeNameEn: "Should Not Exist Shop",
            vatNumber: "300000000009999",
            ownerEmail: "shouldnotexist@example.com",
            ownerPassword: "RoutePass123!",
          }),
        })
      );
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("returns 400 when required fields are missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({ legalName: "Incomplete Co" }),
      })
    );
    expect(response.status).toBe(400);
  });

  it("lists tenants including the one just created, filtered by search", async () => {
    const response = await GET(new Request("http://localhost/api/admin/tenants?q=Route Test"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tenants.some((t: { tradeNameEn: string }) => t.tradeNameEn === "Route Test Shop")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
set -a && source .env && set +a && npx vitest run src/app/api/admin/tenants/route.test.ts
```

Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 3: Implement the list+create route**

Create `src/app/api/admin/tenants/route.ts`:

```ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { seedTenant } from "@/lib/db/seed-tenant";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { assertCtoRole } from "@/lib/admin-auth/require-cto";
import { AUDIT_ACTIONS } from "@/lib/admin-auth/audit-actions";
import { writeAuditLog } from "@/lib/admin-auth/audit-log";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim();
  const tenants = await prisma.tenant.findMany({
    where: q
      ? { OR: [{ tradeNameEn: { contains: q, mode: "insensitive" } }, { vatNumber: { contains: q } }] }
      : undefined,
    select: {
      id: true,
      legalName: true,
      tradeNameEn: true,
      vatNumber: true,
      billingStatus: true,
      createdAt: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    tenants: tenants.map((t) => ({
      id: t.id,
      legalName: t.legalName,
      tradeNameEn: t.tradeNameEn,
      vatNumber: t.vatNumber,
      billingStatus: t.billingStatus,
      createdAt: t.createdAt,
      ownerEmail: t.users[0]?.email ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const forbidden = assertCtoRole(session.user.role);
  if (forbidden) return forbidden;

  const body = await request.json();

  const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
  const tradeNameEn = typeof body.tradeNameEn === "string" ? body.tradeNameEn.trim() : "";
  const vatNumber = typeof body.vatNumber === "string" ? body.vatNumber.trim() : "";
  const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";
  const ownerPassword = typeof body.ownerPassword === "string" ? body.ownerPassword : "";

  if (!legalName || !tradeNameEn || !vatNumber || !ownerEmail || !ownerPassword) {
    return NextResponse.json(
      { error: "legalName, tradeNameEn, vatNumber, ownerEmail, and ownerPassword are required" },
      { status: 400 }
    );
  }

  try {
    const result = await seedTenant({
      legalName,
      tradeNameEn,
      tradeNameAr: typeof body.tradeNameAr === "string" ? body.tradeNameAr.trim() || undefined : undefined,
      vatNumber,
      crNumber: typeof body.crNumber === "string" ? body.crNumber.trim() || undefined : undefined,
      phone: typeof body.phone === "string" ? body.phone.trim() || undefined : undefined,
      address: typeof body.address === "string" ? body.address.trim() || undefined : undefined,
      ownerEmail,
      ownerPassword,
    });

    await writeAuditLog({
      agencyStaffId: session.user.agencyStaffId,
      action: AUDIT_ACTIONS.TENANT_CREATED,
      tenantId: result.tenant.id,
      metadata: { tradeNameEn: result.tenant.tradeNameEn, ownerEmail: result.user.email },
    });

    return NextResponse.json(
      { id: result.tenant.id, tradeNameEn: result.tenant.tradeNameEn, vatNumber: result.tenant.vatNumber },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "A tenant with this VAT number or an account with this owner email already exists" }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
set -a && source .env && set +a && npx vitest run src/app/api/admin/tenants/route.test.ts
```

Expected: PASS, all 5 tests.

- [ ] **Step 5: Write the failing test for the detail route**

Create `src/app/api/admin/tenants/[id]/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { seedTenant } from "@/lib/db/seed-tenant";
import { GET } from "./route";

let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

let ctoId: string;
let tenantId: string;

describe("/api/admin/tenants/[id]", () => {
  beforeAll(async () => {
    const cto = await prisma.agencyStaff.create({
      data: { email: "detail-route-cto@fatoorasync.sa", passwordHash: await hashPassword("x"), role: "CTO" },
    });
    ctoId = cto.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };

    const uniqueId = Date.now();
    const result = await seedTenant({
      legalName: "Detail Route Test Co",
      tradeNameEn: "Detail Route Shop",
      vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
      ownerEmail: `detailroute+${uniqueId}@example.com`,
      ownerPassword: "DetailPass123!",
    });
    tenantId = result.tenant.id;
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.agencyStaff.deleteMany({ where: { id: ctoId } });
    await prisma.$disconnect();
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: tenantId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("returns the tenant's detail", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: tenantId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tradeNameEn).toBe("Detail Route Shop");
    expect(body.billingStatus).toBe("TRIALING");
    expect(body.ownerEmail).toContain("detailroute+");
  });

  it("returns 404 for an unknown tenant id", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
set -a && source .env && set +a && npx vitest run src/app/api/admin/tenants/\[id\]/route.test.ts
```

Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 7: Implement the detail route**

Create `src/app/api/admin/tenants/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      legalName: true,
      tradeNameEn: true,
      tradeNameAr: true,
      vatNumber: true,
      crNumber: true,
      phone: true,
      address: true,
      billingStatus: true,
      trialEndsAt: true,
      featureFlags: true,
      createdAt: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
    },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: tenant.id,
    legalName: tenant.legalName,
    tradeNameEn: tenant.tradeNameEn,
    tradeNameAr: tenant.tradeNameAr,
    vatNumber: tenant.vatNumber,
    crNumber: tenant.crNumber,
    phone: tenant.phone,
    address: tenant.address,
    billingStatus: tenant.billingStatus,
    trialEndsAt: tenant.trialEndsAt,
    featureFlags: tenant.featureFlags,
    createdAt: tenant.createdAt,
    ownerEmail: tenant.users[0]?.email ?? null,
  });
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
set -a && source .env && set +a && npx vitest run src/app/api/admin/tenants/\[id\]/route.test.ts
```

Expected: PASS, all 3 tests.

- [ ] **Step 9: Write the failing test for the billing-edit route**

Create `src/app/api/admin/tenants/[id]/billing/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { seedTenant } from "@/lib/db/seed-tenant";
import { PATCH } from "./route";

let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

let ctoId: string;
let developerId: string;
let tenantId: string;

describe("/api/admin/tenants/[id]/billing", () => {
  beforeAll(async () => {
    const cto = await prisma.agencyStaff.create({
      data: { email: "billing-route-cto@fatoorasync.sa", passwordHash: await hashPassword("x"), role: "CTO" },
    });
    ctoId = cto.id;
    const developer = await prisma.agencyStaff.create({
      data: { email: "billing-route-dev@fatoorasync.sa", passwordHash: await hashPassword("x"), role: "DEVELOPER" },
    });
    developerId = developer.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };

    const uniqueId = Date.now();
    const result = await seedTenant({
      legalName: "Billing Route Test Co",
      tradeNameEn: "Billing Route Shop",
      vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
      ownerEmail: `billingroute+${uniqueId}@example.com`,
      ownerPassword: "BillingPass123!",
    });
    tenantId = result.tenant.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyStaffId: { in: [ctoId, developerId] } } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.agencyStaff.deleteMany({ where: { id: { in: [ctoId, developerId] } } });
    await prisma.$disconnect();
  });

  it("returns 403 when a Developer tries to change billing status", async () => {
    mockSession = { user: { agencyStaffId: developerId, role: "DEVELOPER" } };
    try {
      const response = await PATCH(
        new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ billingStatus: "ACTIVE" }) }),
        { params: Promise.resolve({ id: tenantId }) }
      );
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("rejects an invalid billingStatus value", async () => {
    const response = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ billingStatus: "NOT_A_STATUS" }) }),
      { params: Promise.resolve({ id: tenantId }) }
    );
    expect(response.status).toBe(400);
  });

  it("updates billing status and writes an audit log entry with from/to", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ billingStatus: "ACTIVE", trialEndsAt: null, featureFlags: { earlyAccess: true } }),
      }),
      { params: Promise.resolve({ id: tenantId }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.billingStatus).toBe("ACTIVE");
    expect(body.featureFlags).toEqual({ earlyAccess: true });

    const auditRows = await prisma.auditLog.findMany({ where: { tenantId, action: "BILLING_STATUS_CHANGED" } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata).toMatchObject({ from: "TRIALING", to: "ACTIVE" });
  });

  it("returns 404 for an unknown tenant id", async () => {
    const response = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ billingStatus: "ACTIVE" }) }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

```bash
set -a && source .env && set +a && npx vitest run src/app/api/admin/tenants/\[id\]/billing/route.test.ts
```

Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 11: Implement the billing-edit route**

Create `src/app/api/admin/tenants/[id]/billing/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { assertCtoRole } from "@/lib/admin-auth/require-cto";
import { AUDIT_ACTIONS } from "@/lib/admin-auth/audit-actions";
import { writeAuditLog } from "@/lib/admin-auth/audit-log";

const VALID_STATUSES = ["TRIALING", "ACTIVE", "COMPLIMENTARY", "PAST_DUE", "SUSPENDED"];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const forbidden = assertCtoRole(session.user.role);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = await request.json();

  if (typeof body.billingStatus !== "string" || !VALID_STATUSES.includes(body.billingStatus)) {
    return NextResponse.json({ error: `billingStatus must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const existing = await prisma.tenant.findUnique({ where: { id }, select: { billingStatus: true } });
  if (!existing) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const tenant = await prisma.tenant.update({
    where: { id },
    data: {
      billingStatus: body.billingStatus,
      trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : null,
      featureFlags: body.featureFlags ?? {},
    },
    select: { id: true, billingStatus: true, trialEndsAt: true, featureFlags: true },
  });

  await writeAuditLog({
    agencyStaffId: session.user.agencyStaffId,
    action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
    tenantId: id,
    metadata: { from: existing.billingStatus, to: tenant.billingStatus },
  });

  return NextResponse.json(tenant);
}
```

- [ ] **Step 12: Run the tests to verify they pass**

```bash
set -a && source .env && set +a && npx vitest run src/app/api/admin/tenants/\[id\]/billing/route.test.ts
```

Expected: PASS, all 4 tests.

- [ ] **Step 13: Run the full admin route test suite together, typecheck, lint**

```bash
set -a && source .env && set +a && npx vitest run src/app/api/admin
npx tsc --noEmit
npm run lint
```

Expected: all clean.

- [ ] **Step 14: Commit**

```bash
git add src/app/api/admin
git commit -m "Add admin tenant API routes: list/search, create, detail, billing edit"
```

---

### Task 4: Admin login page, protected layout, sidebar shell

**Files:**
- Create: `src/app/admin/login/page.tsx`
- Create: `src/app/admin/(protected)/layout.tsx`
- Create: `src/components/admin/admin-sidebar.tsx`

**Interfaces:**
- Consumes: `signIn`, `signOut` from `@/lib/admin-auth/config` (Task 2), `getAdminSession` (Task 2).
- Produces: every page in Tasks 5-8 renders as `{ children }` inside this layout's sidebar shell — they do not repeat the sidebar or the auth check themselves.

- [ ] **Step 1: Build the login page**

Create `src/app/admin/login/page.tsx`. Uses Auth.js v5's server-action form-binding pattern (`signIn` called directly inside a `"use server"` closure) rather than the tenant login page's client-side `next-auth/react` approach — see the spec §4 for why (the client package doesn't cleanly support a second `basePath`). **Before considering this step done, verify the exact `signIn`/`AuthError` call shape against the installed `next-auth@5.0.0-beta.32` package (check `node_modules/next-auth/README.md` or its type definitions) — beta APIs can differ slightly from what's below, and this must be confirmed by actually signing in through the browser, not just by reading the code.**

```tsx
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/admin-auth/config";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function handleLogin(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/admin",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/admin/login?error=CredentialsSignin");
      }
      throw err;
    }
  }

  return (
    <div dir="ltr" className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form action={handleLogin} className="w-[340px] rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-green-950 text-sm font-extrabold text-white">
            FS
          </div>
          <h1 className="text-[15px] font-semibold text-neutral-900">Agency sign in</h1>
          <p className="mt-1 text-xs text-neutral-500">Separate from tenant Owner/Cashier logins</p>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            Invalid email or password.
          </p>
        )}

        <div className="mb-4">
          <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-neutral-600">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
          />
        </div>

        <div className="mb-5">
          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-neutral-600">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-green-800 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Build the sidebar component**

Create `src/components/admin/admin-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_GROUPS = [
  {
    label: "Business",
    items: [
      { href: "/admin", label: "Dashboard" },
      { href: "/admin/tenants", label: "Tenants" },
      { href: "/admin/analytics", label: "Analytics", soon: true },
    ],
  },
  {
    label: "Agency",
    items: [
      { href: "/admin/staff", label: "Staff", soon: true },
      { href: "/admin/audit", label: "Audit Log", soon: true },
    ],
  },
];

export function AdminSidebar({
  email,
  role,
  signOutAction,
}: {
  email: string;
  role: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex w-56 shrink-0 flex-col border-e border-neutral-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-4 text-[14.5px] font-bold text-neutral-900">
        <span className="size-2 rounded-full bg-green-700" />
        FatooraSync
        <span className="ms-auto rounded border border-neutral-200 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-neutral-500">
          Admin
        </span>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mt-3">
          <div className="px-4 pb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">
            {group.label}
          </div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 border-s-2 px-4 py-2 text-[13px] font-medium ${
                isActive(item.href)
                  ? "border-green-700 bg-green-50 text-green-950"
                  : "border-transparent text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
              }`}
            >
              {item.label}
              {item.soon && (
                <span className="ms-auto rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] font-bold text-neutral-500">
                  soon
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}

      <div className="mt-auto flex items-center gap-2.5 border-t border-neutral-200 px-4 py-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green-950 text-[11px] font-bold text-white">
          {role === "CTO" ? "CT" : "DV"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-neutral-900">{email}</div>
          <div className="text-[10px] font-bold text-green-800">{role}</div>
        </div>
        <form action={signOutAction}>
          <button type="submit" title="Sign out" className="text-neutral-400 hover:text-red-600">
            ×
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build the protected layout**

Create `src/app/admin/(protected)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { signOut } from "@/lib/admin-auth/config";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const staff = await prisma.agencyStaff.findUniqueOrThrow({
    where: { id: session.user.agencyStaffId },
    select: { email: true },
  });

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/admin/login" });
  }

  return (
    <div dir="ltr" className="flex min-h-screen bg-neutral-50">
      <AdminSidebar email={staff.email} role={session.user.role} signOutAction={handleSignOut} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Manually verify in the browser**

Start the dev server, navigate to `/admin`. Expected: redirected to `/admin/login` (no session yet). Sign in with the credentials created by Task 2's seed script (`cto@fatoorasync.sa` / `changeme123`, or whatever was actually used). Expected: redirected to `/admin`, sidebar visible with Dashboard/Tenants/Analytics/Staff/Audit Log, "soon" badges on the last three, account block at the bottom showing the signed-in email and `CTO`. Click sign-out; expected: redirected back to `/admin/login`, and re-visiting `/admin` redirects to login again (session actually cleared, not just UI-hidden). Separately, confirm `/` (the tenant app) and its login are completely unaffected — sign in as the tenant demo Owner (`owner@demo.local`) in the same browser and confirm both sessions coexist without either logging the other out.

- [ ] **Step 5: Typecheck and lint**

```bash
set -a && source .env && set +a && npx tsc --noEmit
npm run lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/login "src/app/admin/(protected)/layout.tsx" src/components/admin/admin-sidebar.tsx
git commit -m "Add admin login page, protected layout, and sidebar shell"
```

---

### Task 5: Dashboard and Tenant list

**Files:**
- Create: `src/app/admin/(protected)/page.tsx`
- Create: `src/app/admin/(protected)/tenants/page.tsx`
- Create: `src/components/admin/status-pill.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/tenants` (Task 3) via a direct `prisma.tenant.findMany` call in the Dashboard's own Server Component (not the API route — a page fetching its own data server-side doesn't need to round-trip through its own API), and via `fetch` from the list page's client-side search.
- Produces: `StatusPill({ status }: { status: string })` — reused by Task 6 and Task 7.

- [ ] **Step 1: Build the shared status pill**

Create `src/components/admin/status-pill.tsx`. `PAST_DUE` and `SUSPENDED` are both red but must read as visually distinct per the Global Constraints — `PAST_DUE` uses Tailwind's `red-600`/`red-50` (a lighter, more saturated red), `SUSPENDED` uses `red-800`/`red-100` (a darker, more muted red):

```tsx
const STYLES: Record<string, string> = {
  TRIALING: "bg-amber-50 text-amber-700",
  ACTIVE: "bg-green-50 text-green-800",
  COMPLIMENTARY: "bg-blue-50 text-blue-700",
  PAST_DUE: "bg-red-50 text-red-600",
  SUSPENDED: "bg-red-100 text-red-800",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STYLES[status] ?? "bg-neutral-100 text-neutral-600"}`}>
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Build the Dashboard page**

Create `src/app/admin/(protected)/page.tsx`:

```tsx
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { StatusPill } from "@/components/admin/status-pill";

const STATUS_ORDER = ["TRIALING", "ACTIVE", "COMPLIMENTARY", "PAST_DUE", "SUSPENDED"] as const;
const STATUS_BAR_COLOR: Record<string, string> = {
  TRIALING: "#D97706",
  ACTIVE: "#15803D",
  COMPLIMENTARY: "#1D4ED8",
  PAST_DUE: "#DC2626",
  SUSPENDED: "#991B1B",
};

export default async function AdminDashboardPage() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, tradeNameEn: true, billingStatus: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const counts: Record<string, number> = {};
  for (const t of tenants) counts[t.billingStatus] = (counts[t.billingStatus] ?? 0) + 1;
  const total = tenants.length;
  const needsAttention = (counts.PAST_DUE ?? 0) + (counts.SUSPENDED ?? 0);
  const recent = tenants.slice(0, 5);

  return (
    <div className="mx-auto max-w-4xl px-7 py-8">
      <h1 className="text-xl font-bold text-neutral-900">Overview</h1>
      <p className="mb-6 text-sm text-neutral-500">Where the business stands right now</p>

      <div className="mb-7 grid grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-extrabold text-neutral-900">{total}</div>
          <div className="text-[11.5px] font-semibold text-neutral-500">Total tenants</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-extrabold text-green-800">{counts.ACTIVE ?? 0}</div>
          <div className="text-[11.5px] font-semibold text-neutral-500">Active</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-extrabold text-amber-700">{counts.TRIALING ?? 0}</div>
          <div className="text-[11.5px] font-semibold text-neutral-500">Trialing</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-2xl font-extrabold text-red-700">{needsAttention}</div>
          <div className="text-[11.5px] font-semibold text-neutral-500">Needs attention</div>
        </div>
      </div>

      {total > 0 && (
        <div className="mb-7">
          <p className="mb-2.5 text-[13px] font-bold text-neutral-900">Status breakdown</p>
          <div className="rounded-xl border border-neutral-200 bg-white p-5">
            <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
              {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
                <div key={s} style={{ width: `${((counts[s] ?? 0) / total) * 100}%`, background: STATUS_BAR_COLOR[s] }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-4 text-[11.5px] text-neutral-600">
              {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full" style={{ background: STATUS_BAR_COLOR[s] }} />
                  {s} ({counts[s]})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2.5 text-[13px] font-bold text-neutral-900">Recently added tenants</p>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {recent.length === 0 ? (
            <p className="py-8 text-center text-xs text-neutral-400">No tenants yet.</p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/tenants/${t.id}`} className="font-semibold text-neutral-900">
                        {t.tradeNameEn}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={t.billingStatus} />
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{t.createdAt.toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build the Tenant list page**

Create `src/app/admin/(protected)/tenants/page.tsx`:

```tsx
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { StatusPill } from "@/components/admin/status-pill";

export default async function AdminTenantsPage() {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      legalName: true,
      tradeNameEn: true,
      vatNumber: true,
      billingStatus: true,
      createdAt: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-5xl px-7 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Tenants</h1>
          <p className="text-sm text-neutral-500">Every shop running on FatooraSync</p>
        </div>
        <Link
          href="/admin/tenants/new"
          className="rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700"
        >
          + New Tenant
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {tenants.length === 0 ? (
          <p className="py-10 text-center text-xs text-neutral-400">No tenants yet — create the first one.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">VAT Number</th>
                <th className="px-4 py-3">Billing status</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/tenants/${t.id}`} className="block">
                      <div className="font-semibold text-neutral-900">{t.tradeNameEn}</div>
                      <div className="text-[12px] text-neutral-400">{t.legalName}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-neutral-600">{t.vatNumber}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.billingStatus} />
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{t.users[0]?.email ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-400">{t.createdAt.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

Search (`?q=`) is deferred out of this task's first cut — the list page renders every tenant directly from the database with no client component needed yet. This is fine at today's tenant count (one). If search becomes genuinely necessary before Task 7 ships, add a client-side filter component then rather than building it speculatively now.

- [ ] **Step 4: Manually verify in the browser**

Visit `/admin` — expect the Dashboard showing 1 total tenant (Demo Shop, TRIALING), the breakdown bar showing 100% amber, and Demo Shop in "Recently added." Visit `/admin/tenants` — expect the same tenant in the table with a working "+ New Tenant" link (404 for now, built in Task 6).

- [ ] **Step 5: Typecheck and lint**

```bash
set -a && source .env && set +a && npx tsc --noEmit
npm run lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/admin/(protected)/page.tsx" "src/app/admin/(protected)/tenants/page.tsx" src/components/admin/status-pill.tsx
git commit -m "Add admin Dashboard and Tenant list pages"
```

---

### Task 6: Tenant create form

**Files:**
- Create: `src/app/admin/(protected)/tenants/new/page.tsx`
- Create: `src/components/admin/tenant-create-form.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/tenants` (Task 3), `PASSWORD_RULES`/`isPasswordValid` from `@/lib/auth/password-rules` (existing), `useToast` from `@/lib/toast/toast-provider` (existing).

- [ ] **Step 1: Build the create-tenant form**

Create `src/components/admin/tenant-create-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PASSWORD_RULES, isPasswordValid } from "@/lib/auth/password-rules";
import { useToast } from "@/lib/toast/toast-provider";

const RULE_LABELS: Record<string, string> = {
  minLength: "8+ characters",
  uppercase: "Uppercase letter",
  number: "Number",
  special: "Special character",
};

function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let pw = "";
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

export function TenantCreateForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      legalName: form.get("legalName"),
      tradeNameEn: form.get("tradeNameEn"),
      tradeNameAr: form.get("tradeNameAr"),
      vatNumber: form.get("vatNumber"),
      crNumber: form.get("crNumber"),
      phone: form.get("phone"),
      address: form.get("address"),
      ownerEmail: form.get("ownerEmail"),
      ownerPassword: password,
    };

    if (!isPasswordValid(password)) {
      setError("Password does not meet the requirements below.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/tenants", { method: "POST", body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      toast.success(`Tenant "${body.tradeNameEn}" created`);
      router.push(`/admin/tenants/${body.id}`);
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl rounded-xl border border-neutral-200 bg-white p-6">
      <p className="mb-4 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Business details</p>
      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <Field label="Legal name" name="legalName" required />
        <Field label="VAT number" name="vatNumber" required mono />
        <Field label="Trade name (English)" name="tradeNameEn" required />
        <Field label="Trade name (Arabic)" name="tradeNameAr" dir="rtl" />
        <Field label="CR number" name="crNumber" mono />
        <Field label="Phone" name="phone" />
      </div>
      <Field label="Address" name="address" />

      <p className="mb-4 mt-6 text-[11px] font-bold uppercase tracking-wide text-neutral-400">Owner account</p>
      <div className="mb-1 grid grid-cols-2 gap-3.5">
        <Field label="Owner email" name="ownerEmail" type="email" required />
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-neutral-600">Owner password</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
            />
            <button
              type="button"
              onClick={() => setPassword(randomPassword())}
              className="shrink-0 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-600 hover:border-green-700"
            >
              Generate
            </button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li key={rule.id} className={ok ? "text-green-800" : "text-neutral-400"}>
                  {ok ? "✓" : "○"} {RULE_LABELS[rule.id]}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="mb-6 text-[11px] text-neutral-400">No email is sent — you share these credentials with the Owner directly.</p>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="flex justify-end gap-2.5 border-t border-neutral-100 pt-5">
        <button
          type="button"
          onClick={() => router.push("/admin/tenants")}
          className="rounded-lg border border-neutral-200 px-4 py-2 text-[13px] font-semibold text-neutral-600"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create tenant"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  type = "text",
  mono,
  dir,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  mono?: boolean;
  dir?: "rtl" | "ltr";
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-neutral-600">
        {label} {required && <span className="font-normal text-neutral-400">required</span>}
      </label>
      <input
        name={name}
        type={type}
        dir={dir}
        className={`w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700 ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
```

- [ ] **Step 2: Build the page wrapper**

Create `src/app/admin/(protected)/tenants/new/page.tsx`:

```tsx
import Link from "next/link";
import { TenantCreateForm } from "@/components/admin/tenant-create-form";

export default function AdminNewTenantPage() {
  return (
    <div className="mx-auto max-w-2xl px-7 py-8">
      <div className="mb-1 text-xs text-neutral-400">
        <Link href="/admin/tenants" className="hover:text-green-800">
          Tenants
        </Link>{" "}
        / New
      </div>
      <h1 className="mb-1 text-xl font-bold text-neutral-900">New tenant</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Creates the shop and its Owner account in one step — same as the seed script, from a screen.
      </p>
      <TenantCreateForm />
    </div>
  );
}
```

- [ ] **Step 3: Manually verify in the browser**

Visit `/admin/tenants/new`. Fill in legal name, trade name (English), VAT number, owner email; click "Generate" for the password and confirm all four checklist items turn green. Submit. Expected: success toast, redirect to the new tenant's `/admin/tenants/[id]` (which 404s until Task 7 — that's expected for now), and the new tenant now appears in `/admin/tenants` and on the Dashboard. Try submitting with a weak password typed manually (e.g. `abc`) — expect the inline error and no request sent. Try submitting with a VAT number that already exists — expect the 409 surfaced as the inline error.

- [ ] **Step 4: Typecheck and lint**

```bash
set -a && source .env && set +a && npx tsc --noEmit
npm run lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/admin/(protected)/tenants/new" src/components/admin/tenant-create-form.tsx
git commit -m "Add admin tenant-create form"
```

---

### Task 7: Tenant detail and billing-edit form

**Files:**
- Create: `src/app/admin/(protected)/tenants/[id]/page.tsx`
- Create: `src/components/admin/tenant-billing-form.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/tenants/[id]`, `PATCH /api/admin/tenants/[id]/billing` (Task 3), `StatusPill` (Task 5).

- [ ] **Step 1: Build the billing-edit form**

Create `src/components/admin/tenant-billing-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/toast/toast-provider";

const STATUSES = ["TRIALING", "ACTIVE", "COMPLIMENTARY", "PAST_DUE", "SUSPENDED"];

export function TenantBillingForm({
  tenantId,
  initialStatus,
  initialTrialEndsAt,
  initialFeatureFlags,
}: {
  tenantId: string;
  initialStatus: string;
  initialTrialEndsAt: string | null;
  initialFeatureFlags: unknown;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState(initialStatus);
  const [trialEndsAt, setTrialEndsAt] = useState(initialTrialEndsAt ?? "");
  const [flagsText, setFlagsText] = useState(JSON.stringify(initialFeatureFlags ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    let featureFlags: unknown;
    try {
      featureFlags = JSON.parse(flagsText || "{}");
    } catch {
      setError("Feature flags must be valid JSON.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}/billing`, {
        method: "PATCH",
        body: JSON.stringify({
          billingStatus: status,
          trialEndsAt: status === "TRIALING" ? trialEndsAt || null : null,
          featureFlags,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      toast.success("Billing status updated · audit log entry written");
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="mb-4 text-[13px] font-bold text-neutral-900">Billing &amp; access</p>

      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">Billing status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-neutral-400">
          SUSPENDED blocks the tenant&apos;s app immediately — checked server-side on every page load, not just at login.
        </p>
      </div>

      <div className="mb-4" style={{ opacity: status === "TRIALING" ? 1 : 0.4 }}>
        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">
          Trial ends <span className="font-normal text-neutral-400">only used while TRIALING</span>
        </label>
        <input
          type="date"
          value={trialEndsAt ? trialEndsAt.slice(0, 10) : ""}
          onChange={(e) => setTrialEndsAt(e.target.value)}
          disabled={status !== "TRIALING"}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700 disabled:bg-neutral-50"
        />
      </div>

      <div className="mb-2">
        <label className="mb-1.5 block text-xs font-semibold text-neutral-600">
          Feature flags <span className="font-normal text-neutral-400">optional, JSON</span>
        </label>
        <textarea
          value={flagsText}
          onChange={(e) => setFlagsText(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs outline-none focus:border-green-700"
        />
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-4 flex justify-end border-t border-neutral-100 pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-green-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <p className="mt-4 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3 text-[11.5px] leading-relaxed text-neutral-500">
        <span className="font-semibold text-neutral-600">Recorded, not yet browsable:</span> saving this writes a{" "}
        <code className="font-mono">BILLING_STATUS_CHANGED</code> row to the audit log (who, what, when) — the Audit
        Log screen to browse it is a later pass.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Build the detail page**

Create `src/app/admin/(protected)/tenants/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { StatusPill } from "@/components/admin/status-pill";
import { TenantBillingForm } from "@/components/admin/tenant-billing-form";

export default async function AdminTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      legalName: true,
      tradeNameEn: true,
      vatNumber: true,
      billingStatus: true,
      trialEndsAt: true,
      featureFlags: true,
      createdAt: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
    },
  });

  if (!tenant) notFound();

  return (
    <div className="mx-auto max-w-4xl px-7 py-8">
      <div className="mb-1 text-xs text-neutral-400">
        <Link href="/admin/tenants" className="hover:text-green-800">
          Tenants
        </Link>{" "}
        / {tenant.tradeNameEn}
      </div>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-bold text-neutral-900">{tenant.tradeNameEn}</h1>
        <StatusPill status={tenant.billingStatus} />
      </div>

      <div className="grid grid-cols-[1fr_1.4fr] gap-5">
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <p className="mb-4 text-[13px] font-bold text-neutral-900">Business info</p>
          <InfoRow label="Legal name" value={tenant.legalName} />
          <InfoRow label="VAT number" value={tenant.vatNumber} mono />
          <InfoRow label="Owner" value={tenant.users[0]?.email ?? "—"} />
          <InfoRow label="Created" value={tenant.createdAt.toLocaleDateString()} />
        </div>

        <TenantBillingForm
          tenantId={tenant.id}
          initialStatus={tenant.billingStatus}
          initialTrialEndsAt={tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null}
          initialFeatureFlags={tenant.featureFlags}
        />
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-neutral-100 py-2.5 text-[13px] last:border-0">
      <span className="text-neutral-400">{label}</span>
      <span className={`font-semibold text-neutral-900 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 3: Manually verify in the browser**

Visit a tenant's detail page (the one created in Task 6, or Demo Shop). Confirm business-info card shows the right data. Change billing status to `ACTIVE`, click "Save changes" — expect a success toast, the pill updates to green ACTIVE after `router.refresh()`, and the trial-end date field becomes disabled/faded. Switch back to `TRIALING`, set a trial-end date, save again — confirm it persists across a full page reload. Type invalid JSON into the feature-flags box and save — expect the inline "must be valid JSON" error with no request sent. Confirm the "Recorded, not yet browsable" note is visible.

- [ ] **Step 4: Typecheck and lint**

```bash
set -a && source .env && set +a && npx tsc --noEmit
npm run lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/admin/(protected)/tenants/[id]" src/components/admin/tenant-billing-form.tsx
git commit -m "Add admin tenant detail page with billing-status editing"
```

---

### Task 8: Analytics/Staff/Audit Log roadmap pages

**Files:**
- Create: `src/components/admin/roadmap-card.tsx`
- Create: `src/app/admin/(protected)/analytics/page.tsx`
- Create: `src/app/admin/(protected)/staff/page.tsx`
- Create: `src/app/admin/(protected)/audit/page.tsx`

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Build the shared roadmap-card component**

Create `src/components/admin/roadmap-card.tsx`:

```tsx
export function RoadmapCard({ title, blurb, items }: { title: string; blurb: string; items: string[] }) {
  return (
    <div className="mx-auto mt-14 max-w-md text-center">
      <span className="mb-4 inline-block rounded-full bg-amber-50 px-3 py-1 text-[10.5px] font-bold text-amber-700">
        Later pass
      </span>
      <h2 className="mb-2 text-[17px] font-bold text-neutral-900">{title}</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-500">{blurb}</p>
      <ul className="inline-block text-left text-[12.5px] leading-loose text-neutral-600">
        {items.map((item) => (
          <li key={item} className="list-disc">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Build the three static pages**

Create `src/app/admin/(protected)/analytics/page.tsx`:

```tsx
import { RoadmapCard } from "@/components/admin/roadmap-card";

export default function AdminAnalyticsPage() {
  return (
    <div className="px-7 py-8">
      <RoadmapCard
        title="Analytics"
        blurb="Cross-tenant trends, once there's enough usage data to make them meaningful. Planned for this screen:"
        items={[
          "Revenue/status trend over time (TRIALING → ACTIVE conversion, churn)",
          "Per-tenant engagement — receipts/quotations created, last login",
          "Early warning signals for at-risk accounts (PAST_DUE, inactivity)",
        ]}
      />
    </div>
  );
}
```

Create `src/app/admin/(protected)/staff/page.tsx`:

```tsx
import { RoadmapCard } from "@/components/admin/roadmap-card";

export default function AdminStaffPage() {
  return (
    <div className="px-7 py-8">
      <RoadmapCard
        title="Staff"
        blurb="Right now it's just you, seeded directly into the database. This screen arrives once there's a second agency person:"
        items={[
          "CTO creates/removes Developer accounts",
          "Developer: support and impersonation access, no billing control",
          "CTO: full control, including this screen itself",
        ]}
      />
    </div>
  );
}
```

Create `src/app/admin/(protected)/audit/page.tsx`:

```tsx
import { RoadmapCard } from "@/components/admin/roadmap-card";

export default function AdminAuditPage() {
  return (
    <div className="px-7 py-8">
      <RoadmapCard
        title="Audit Log"
        blurb="The log itself is already being written (every billing change, every tenant created) — this is just the screen to browse it:"
        items={[
          "Filter by tenant, staff member, or action type",
          "Every impersonation session, once that ships",
          "Nothing to reconstruct after the fact — it's captured from day one",
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 3: Manually verify in the browser**

Click each of Analytics, Staff, and Audit Log in the sidebar. Expect each to render its roadmap card with the correct title/blurb/bullets, the sidebar's active-item highlight to follow correctly, and no console errors.

- [ ] **Step 4: Typecheck and lint**

```bash
set -a && source .env && set +a && npx tsc --noEmit
npm run lint
```

Expected: clean.

- [ ] **Step 5: Run the full test suite**

```bash
set -a && source .env && set +a && npx vitest run
```

Expected: every test passes, including all of Tasks 1-3's new tests alongside the full pre-existing suite.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/roadmap-card.tsx "src/app/admin/(protected)/analytics" "src/app/admin/(protected)/staff" "src/app/admin/(protected)/audit"
git commit -m "Add Analytics/Staff/Audit Log roadmap placeholder pages"
```
