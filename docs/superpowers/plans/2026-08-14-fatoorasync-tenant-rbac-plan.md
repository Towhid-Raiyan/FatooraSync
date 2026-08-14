# Tenant-Side RBAC (Owner/Cashier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `User` a `role` (`OWNER | CASHIER`), enforce the three-tier access model from the design spec at both the page and API layer, and give an Owner a working screen to create and manage Cashier accounts.

**Architecture:** `role` rides through the existing JWT session exactly like `tenantId` already does — no new DB round-trip on any request. Enforcement is dual-layer everywhere it matters (page-level UI hiding + API-level rejection), mirroring the pattern already established for the billing access gate. Two small, focused RBAC guard modules (`assertOwnerRole`, `assertCanManageCatalog`) keep the same check from being duplicated across the ~7 call sites that need it.

**Tech Stack:** Next.js 15 App Router, Prisma/PostgreSQL, NextAuth v5 (JWT sessions), Vitest.

**Design spec:** [2026-08-14-fatoorasync-tenant-rbac-design.md](../specs/2026-08-14-fatoorasync-tenant-rbac-design.md)

## Global Constraints

- Existing `User` rows must all become `role: OWNER`, `isActive: true` with zero backfill — use `@default(...)` on both new columns, not a data migration statement.
- `role` and `tenantId` travel through the JWT/session together, using the exact callback pattern already in `src/lib/auth/auth.config.ts` — no extra database query to read role anywhere it's already available from `session.user`.
- Every mutation-gating check (Owner-only, catalog-toggle) must exist at BOTH the page/component layer (hide the control) and the API layer (reject the request) — client-side hiding alone is never sufficient, matching the billing-gate slice's established pattern.
- New UI copy goes through the i18n dictionary (`src/lib/i18n/dictionaries/`), added to `dictionary.types.ts`, `en.ts`, and `ar.ts` together. API error strings stay hardcoded English, matching every existing route in this codebase (e.g. `"This barcode is already in use by another product"`) — this plan does not introduce a new pattern for translating server error text.
- Cashier account "removal" is a soft `isActive` toggle, matching the existing Products/Customers deactivate/reactivate pattern — never a real `delete`.
- Password requirements for new Cashier accounts (min 8 chars, 1 uppercase, 1 number, 1 special character) live in one shared, pure module imported by both the client checklist and the server-side check — they must never be defined twice.

---

## Task 1: Schema — `User.role`/`isActive`, session plumbing, login enforcement

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<generated>/migration.sql` (via `npx prisma migrate dev`)
- Modify: `src/lib/db/tenant-context.ts`
- Modify: `src/lib/auth/config.ts`
- Modify: `src/lib/auth/auth.config.ts`
- Modify: `src/lib/auth/next-auth.d.ts`
- Modify (tests): `src/lib/auth/config.test.ts`
- Modify (tests): `src/lib/db/tenant-context.test.ts`

**Interfaces:**
- Produces: `session.user.role: "OWNER" | "CASHIER"`, available via `auth()` anywhere `session.user.tenantId` already is. `User` model gains `role` and `isActive` columns. `"User"` becomes a tenant-scoped model through `withTenant()`.

- [ ] **Step 1: Add the `UserRole` enum and the two new `User` columns to the schema**

In `prisma/schema.prisma`, add a new enum after `enum BillingStatus { ... }` and before `model Tenant`:

```prisma
enum UserRole {
  OWNER
  CASHIER
}
```

Then update the `User` model to:

```prisma
model User {
  id           String   @id @default(uuid())
  tenantId     String
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  email        String   @unique
  passwordHash String
  role         UserRole @default(OWNER)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())

  sessions Session[]
}
```

- [ ] **Step 2: Generate and apply the migration**

Run:

```bash
npx prisma migrate dev --name add_user_role_and_active_flag
```

This generates a new folder under `prisma/migrations/` with a `migration.sql` containing a `CREATE TYPE "UserRole" AS ENUM (...)` and an `ALTER TABLE "User" ADD COLUMN "role" ... ADD COLUMN "isActive" ...` — both with `DEFAULT` values, no `UPDATE` statement (matches the shape of `prisma/migrations/20260814061339_add_tenant_billing_fields_and_settings_catalog_toggle/migration.sql`, the most recent prior migration). Confirm the generated file has no data-migration statement before continuing — if Prisma prompts about data loss or asks how to migrate existing rows, stop and report back rather than accepting a lossy default.

- [ ] **Step 3: Write a failing test proving `User` should be tenant-scoped through `withTenant()`**

Add to `src/lib/db/tenant-context.test.ts`, inside the existing `describe("tenant isolation", ...)` block, after the last `it(...)`:

```ts
  it("scopes User rows to the active tenant, same as Customer", async () => {
    await withTenant(tenantAId, (tx) =>
      tx.user.create({ data: { tenantId: tenantAId, email: "owner-a@tenant-isolation-test.local", passwordHash: "x" } })
    );
    await withTenant(tenantBId, (tx) =>
      tx.user.create({ data: { tenantId: tenantBId, email: "owner-b@tenant-isolation-test.local", passwordHash: "x" } })
    );

    const usersSeenByA = await withTenant(tenantAId, (tx) => tx.user.findMany());
    expect(usersSeenByA).toHaveLength(1);
    expect(usersSeenByA[0].email).toBe("owner-a@tenant-isolation-test.local");
  });
```

Also update this file's `afterAll` to clean up the new rows — change:

```ts
  afterAll(async () => {
    await withTenant(tenantAId, (tx) => tx.customer.deleteMany({ where: { tenantId: tenantAId } }));
    await withTenant(tenantBId, (tx) => tx.customer.deleteMany({ where: { tenantId: tenantBId } }));
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    await prisma.$disconnect();
  });
```

to:

```ts
  afterAll(async () => {
    await withTenant(tenantAId, (tx) => tx.customer.deleteMany({ where: { tenantId: tenantAId } }));
    await withTenant(tenantBId, (tx) => tx.customer.deleteMany({ where: { tenantId: tenantBId } }));
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/lib/db/tenant-context.test.ts`
Expected: FAIL — `"User"` is not yet in `TENANT_SCOPED_MODELS`, so `tx.user.findMany()` runs with no `tenantId` filter at all and returns both tenants' users, failing the `toHaveLength(1)` assertion.

- [ ] **Step 5: Add `"User"` to the tenant-isolation extension**

In `src/lib/db/tenant-context.ts`, change:

```ts
const TENANT_SCOPED_MODELS = new Set(["Customer", "Product", "Document", "DocumentLine", "Settings"]);
```

to:

```ts
const TENANT_SCOPED_MODELS = new Set(["Customer", "Product", "Document", "DocumentLine", "Settings", "User"]);
```

- [ ] **Step 6: Run the test again to verify it passes**

Run: `npx vitest run src/lib/db/tenant-context.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 7: Update `authorize()` to check `isActive` and return `role`**

In `src/lib/auth/config.ts`, change the end of `authorize()` from:

```ts
  resetAttempts(rateLimitKey);
  return { id: user.id, email: user.email, tenantId: user.tenantId };
}
```

to:

```ts
  if (!user.isActive) {
    recordFailedAttempt(rateLimitKey);
    return null;
  }

  resetAttempts(rateLimitKey);
  return { id: user.id, email: user.email, tenantId: user.tenantId, role: user.role };
}
```

The `isActive` check sits after password verification (so a deactivated account's login fails identically to a wrong password — no distinct error) and calls `recordFailedAttempt` for consistency with the other rejection path, so a deactivated account can't be used to probe the rate limiter differently than a wrong password would.

- [ ] **Step 8: Carry `role` through the JWT/session callbacks**

In `src/lib/auth/auth.config.ts`, change:

```ts
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.tenantId = (user as { tenantId: string }).tenantId;
      }
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, tenantId: token.tenantId as string },
    }),
  },
```

to:

```ts
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        const typedUser = user as { tenantId: string; role: string };
        token.tenantId = typedUser.tenantId;
        token.role = typedUser.role;
      }
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, tenantId: token.tenantId as string, role: token.role as string },
    }),
  },
```

- [ ] **Step 9: Extend the session type augmentation**

In `src/lib/auth/next-auth.d.ts`, change:

```ts
declare module "next-auth" {
  interface Session {
    user: {
      tenantId: string;
    } & DefaultSession["user"];
  }
}
```

to:

```ts
declare module "next-auth" {
  interface Session {
    user: {
      tenantId: string;
      role: string;
    } & DefaultSession["user"];
  }
}
```

- [ ] **Step 10: Add failing tests for the new `authorize()` behavior**

Add to `src/lib/auth/config.test.ts`, inside the existing `describe("credentials authorize", ...)` block, after the last `it(...)`:

```ts
  it("returns the user's role alongside tenantId", async () => {
    const user = await authorize({ email: "owner@example.com", password: "supersecret123" });
    expect(user?.role).toBe("OWNER");
  });

  it("returns null for a deactivated user, even with the correct password", async () => {
    const email = "deactivated-login-test@example.com";
    await prisma.user.create({
      data: { tenantId, email, passwordHash: await hashPassword("correct-password"), isActive: false },
    });

    const result = await authorize({ email, password: "correct-password" });
    expect(result).toBeNull();
  });
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx vitest run src/lib/auth/config.test.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 12: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. (`session.user.role` is now a required field on the `Session` type — any existing test file with a hand-rolled `mockSession` object missing `role` will fail `tsc --noEmit`. This plan's Task 3 fixes every such file; if `tsc` fails here on a file this task doesn't otherwise touch, note it in your report so Task 3 can confirm it covers that file.)

- [ ] **Step 13: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/db/tenant-context.ts src/lib/db/tenant-context.test.ts src/lib/auth/config.ts src/lib/auth/auth.config.ts src/lib/auth/next-auth.d.ts src/lib/auth/config.test.ts
git commit -m "Add User.role/isActive and carry role through the session"
```

---

## Task 2: Shared RBAC guard + Add-Cashier API

**Files:**
- Create: `src/lib/auth/password-rules.ts`
- Create: `src/lib/auth/password-rules.test.ts`
- Create: `src/lib/rbac/require-owner.ts`
- Create: `src/lib/rbac/require-owner.test.ts`
- Create: `src/app/api/users/route.ts`
- Create: `src/app/api/users/route.test.ts`
- Create: `src/app/api/users/[id]/route.ts`
- Create: `src/app/api/users/[id]/route.test.ts`

**Interfaces:**
- Consumes: `session.user.role: string` (Task 1), `withTenant()` scoping `"User"` (Task 1), `hashPassword()` from `src/lib/auth/password.ts` (existing), `assertTenantAccess()` from `src/lib/billing/require-tenant-access.ts` (existing).
- Produces: `assertOwnerRole(role: string | undefined): NextResponse | null` (also consumed by Task 3 and Task 5's Staff UI indirectly via the API), `PASSWORD_RULES`/`isPasswordValid()` from `password-rules.ts` (also consumed by Task 5's password checklist UI), `POST /api/users`, `PATCH /api/users/[id]`.

- [ ] **Step 1: Write the password rules module**

Create `src/lib/auth/password-rules.ts`:

```ts
export interface PasswordRule {
  id: "minLength" | "uppercase" | "number" | "special";
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "minLength", test: (p) => p.length >= 8 },
  { id: "uppercase", test: (p) => /[A-Z]/.test(p) },
  { id: "number", test: (p) => /[0-9]/.test(p) },
  { id: "special", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function isPasswordValid(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}
```

`id` is a dictionary key suffix (`dict.staff.passwordRules[rule.id]`), not display text — the client checklist component (Task 5) resolves the label at render time, keeping this module free of any i18n or UI concern.

- [ ] **Step 2: Write failing tests for the password rules**

Create `src/lib/auth/password-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPasswordValid, PASSWORD_RULES } from "./password-rules";

describe("isPasswordValid", () => {
  it("rejects a password shorter than 8 characters", () => {
    expect(isPasswordValid("Ab1!xyz")).toBe(false);
  });

  it("rejects a password with no uppercase letter", () => {
    expect(isPasswordValid("abcdefg1!")).toBe(false);
  });

  it("rejects a password with no number", () => {
    expect(isPasswordValid("Abcdefgh!")).toBe(false);
  });

  it("rejects a password with no special character", () => {
    expect(isPasswordValid("Abcdefg1")).toBe(false);
  });

  it("accepts a password meeting all four rules", () => {
    expect(isPasswordValid("Abcdefg1!")).toBe(true);
  });

  it("exposes exactly four rules, one per requirement", () => {
    expect(PASSWORD_RULES.map((r) => r.id).sort()).toEqual(["minLength", "number", "special", "uppercase"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail, then implement is already done above — run again to verify pass**

Run: `npx vitest run src/lib/auth/password-rules.test.ts`
Expected: PASS (the implementation was written in Step 1 alongside the interface; if any test fails, fix `password-rules.ts` until all six pass)

- [ ] **Step 4: Write the Owner-only guard**

Create `src/lib/rbac/require-owner.ts`:

```ts
import { NextResponse } from "next/server";

export function assertOwnerRole(role: string | undefined): NextResponse | null {
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Only the Owner can do this" }, { status: 403 });
  }
  return null;
}
```

- [ ] **Step 5: Write tests for the guard**

Create `src/lib/rbac/require-owner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertOwnerRole } from "./require-owner";

describe("assertOwnerRole", () => {
  it("returns null for an Owner", () => {
    expect(assertOwnerRole("OWNER")).toBeNull();
  });

  it("returns a 403 response for a Cashier", async () => {
    const response = assertOwnerRole("CASHIER");
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it("returns a 403 response for an undefined role", async () => {
    const response = assertOwnerRole(undefined);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/rbac/require-owner.test.ts`
Expected: PASS

- [ ] **Step 7: Write `POST /api/users`**

Create `src/app/api/users/route.ts`:

```ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { hashPassword } from "@/lib/auth/password";
import { isPasswordValid } from "@/lib/auth/password-rules";
import { assertOwnerRole } from "@/lib/rbac/require-owner";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const forbidden = assertOwnerRole(session.user.role);
  if (forbidden) return forbidden;

  const body = await request.json();

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!isPasswordValid(password)) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters and include an uppercase letter, a number, and a special character" },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await withTenant(tenantId, (tx) =>
      tx.user.create({
        data: { email, passwordHash, role: "CASHIER" } as Prisma.UserUncheckedCreateInput,
      })
    );
    return NextResponse.json({ id: user.id, email: user.email, role: user.role, isActive: user.isActive }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "This email is already in use" }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 8: Write tests for `POST /api/users`**

Create `src/app/api/users/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { POST } from "./route";

let tenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

const VALID_PASSWORD = "Cashier1!";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/users", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/users", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Users Test Co", tradeNameEn: "Users Test Shop", vatNumber: "300000000000102" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("creates a Cashier account with a valid email and password", async () => {
    const response = await POST(postRequest({ email: "cashier-one@example.com", password: VALID_PASSWORD }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.email).toBe("cashier-one@example.com");
    expect(body.role).toBe("CASHIER");
    expect(body.isActive).toBe(true);
  });

  it("returns 400 for a password missing an uppercase letter", async () => {
    const response = await POST(postRequest({ email: "weak-pw@example.com", password: "lowercase1!" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty email", async () => {
    const response = await POST(postRequest({ email: "   ", password: VALID_PASSWORD }));
    expect(response.status).toBe(400);
  });

  it("returns 409 for an email already in use", async () => {
    await POST(postRequest({ email: "duplicate@example.com", password: VALID_PASSWORD }));
    const response = await POST(postRequest({ email: "duplicate@example.com", password: VALID_PASSWORD }));
    expect(response.status).toBe(409);
  });

  it("returns 403 when the caller is a Cashier, not an Owner", async () => {
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await POST(postRequest({ email: "should-not-be-created@example.com", password: VALID_PASSWORD }));
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await POST(postRequest({ email: "no-session@example.com", password: VALID_PASSWORD }));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/users/route.test.ts`
Expected: PASS

- [ ] **Step 10: Write `PATCH /api/users/[id]`**

Create `src/app/api/users/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { assertOwnerRole } from "@/lib/rbac/require-owner";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const forbidden = assertOwnerRole(session.user.role);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = await request.json();
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
  }

  const existing = await withTenant(tenantId, (tx) => tx.user.findUnique({ where: { id } }));
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (existing.role !== "CASHIER") {
    return NextResponse.json({ error: "Only Cashier accounts can be deactivated here" }, { status: 403 });
  }

  const user = await withTenant(tenantId, (tx) => tx.user.update({ where: { id }, data: { isActive: body.isActive } }));
  return NextResponse.json({ id: user.id, email: user.email, role: user.role, isActive: user.isActive });
}
```

- [ ] **Step 11: Write tests for `PATCH /api/users/[id]`**

Create `src/app/api/users/[id]/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { hashPassword } from "@/lib/auth/password";
import { PATCH } from "./route";

let tenantId: string;
let otherTenantId: string;
let cashierId: string;
let ownerId: string;
let otherTenantCashierId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/users/x", { method: "PATCH", body: JSON.stringify(body) });
}

describe("/api/users/[id]", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "User Patch Test Co", tradeNameEn: "User Patch Shop", vatNumber: "300000000000119" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };

    const cashier = await withTenant(tenantId, (tx) =>
      tx.user.create({ data: { email: "patch-cashier@example.com", passwordHash: await hashPassword("x"), role: "CASHIER" } })
    );
    cashierId = cashier.id;

    const owner = await withTenant(tenantId, (tx) =>
      tx.user.create({ data: { email: "patch-owner@example.com", passwordHash: await hashPassword("x"), role: "OWNER" } })
    );
    ownerId = owner.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other User Patch Co", tradeNameEn: "Other User Patch Shop", vatNumber: "300000000000126" },
    });
    otherTenantId = otherTenant.id;
    const otherCashier = await withTenant(otherTenantId, (tx) =>
      tx.user.create({ data: { email: "other-tenant-cashier@example.com", passwordHash: await hashPassword("x"), role: "CASHIER" } })
    );
    otherTenantCashierId = otherCashier.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("deactivates then reactivates a Cashier", async () => {
    const deactivate = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: cashierId }) });
    expect(deactivate.status).toBe(200);
    expect((await deactivate.json()).isActive).toBe(false);

    const reactivate = await PATCH(patchRequest({ isActive: true }), { params: Promise.resolve({ id: cashierId }) });
    expect(reactivate.status).toBe(200);
    expect((await reactivate.json()).isActive).toBe(true);
  });

  it("returns 403 when targeting an Owner account", async () => {
    const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: ownerId }) });
    expect(response.status).toBe(403);
  });

  it("returns 404 for a user belonging to another tenant", async () => {
    const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: otherTenantCashierId }) });
    expect(response.status).toBe(404);
  });

  it("returns 400 when isActive is not a boolean", async () => {
    const response = await PATCH(patchRequest({ isActive: "false" }), { params: Promise.resolve({ id: cashierId }) });
    expect(response.status).toBe(400);
  });

  it("returns 403 when the caller is a Cashier, not an Owner", async () => {
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: cashierId }) });
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: cashierId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/users`
Expected: PASS (both route test files)

- [ ] **Step 13: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add src/lib/auth/password-rules.ts src/lib/auth/password-rules.test.ts src/lib/rbac/require-owner.ts src/lib/rbac/require-owner.test.ts src/app/api/users
git commit -m "Add password rules, the Owner-only guard, and the Add-Cashier API"
```

---

## Task 3: API-layer enforcement on existing routes

**Files:**
- Create: `src/lib/rbac/require-catalog-access.ts`
- Create: `src/lib/rbac/require-catalog-access.test.ts`
- Modify: `src/app/api/products/route.ts`
- Modify: `src/app/api/products/route.test.ts`
- Modify: `src/app/api/products/[id]/route.ts`
- Modify: `src/app/api/products/[id]/route.test.ts`
- Modify: `src/app/api/customers/route.ts`
- Modify: `src/app/api/customers/route.test.ts`
- Modify: `src/app/api/customers/[id]/route.ts`
- Modify: `src/app/api/customers/[id]/route.test.ts`
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/app/api/settings/route.test.ts`

**Interfaces:**
- Consumes: `assertOwnerRole` from `src/lib/rbac/require-owner.ts` (Task 2), `withTenant()` (existing), `session.user.role` (Task 1).
- Produces: `assertCanManageCatalog(tenantId: string, role: string | undefined): Promise<NextResponse | null>`, and `PATCH /api/settings` now accepts/persists `cashierCanManageCatalog` — consumed by Task 5's Settings UI.

- [ ] **Step 1: Write the catalog-access guard**

Create `src/lib/rbac/require-catalog-access.ts`:

```ts
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db/tenant-context";

export async function assertCanManageCatalog(tenantId: string, role: string | undefined): Promise<NextResponse | null> {
  if (role === "OWNER") return null;

  const settings = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
  if (!settings.cashierCanManageCatalog) {
    return NextResponse.json({ error: "Your Owner has restricted this to Owner-only" }, { status: 403 });
  }
  return null;
}
```

- [ ] **Step 2: Write tests for the guard**

Create `src/lib/rbac/require-catalog-access.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { assertCanManageCatalog } from "./require-catalog-access";

let tenantId: string;

describe("assertCanManageCatalog", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Catalog Access Test Co", tradeNameEn: "Catalog Access Shop", vatNumber: "300000000000133" },
    });
    tenantId = tenant.id;
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
  });

  afterAll(async () => {
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("always allows an Owner, without even checking the toggle", async () => {
    expect(await assertCanManageCatalog(tenantId, "OWNER")).toBeNull();
  });

  it("allows a Cashier when the toggle defaults to true", async () => {
    expect(await assertCanManageCatalog(tenantId, "CASHIER")).toBeNull();
  });

  it("blocks a Cashier once the Owner turns the toggle off", async () => {
    await withTenant(tenantId, (tx) => tx.settings.update({ where: { tenantId }, data: { cashierCanManageCatalog: false } }));
    try {
      const response = await assertCanManageCatalog(tenantId, "CASHIER");
      expect(response).not.toBeNull();
      expect(response?.status).toBe(403);
    } finally {
      await withTenant(tenantId, (tx) => tx.settings.update({ where: { tenantId }, data: { cashierCanManageCatalog: true } }));
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run src/lib/rbac/require-catalog-access.test.ts`
Expected: PASS

- [ ] **Step 4: Wire `assertCanManageCatalog` into `POST /api/products`**

In `src/app/api/products/route.ts`, add the import:

```ts
import { assertCanManageCatalog } from "@/lib/rbac/require-catalog-access";
```

In the `POST` handler, immediately after the existing `if (blocked) return blocked;` line, add:

```ts
  const catalogBlocked = await assertCanManageCatalog(tenantId, session.user.role);
  if (catalogBlocked) return catalogBlocked;
```

(`GET` is unchanged — read access was never role-gated.)

- [ ] **Step 5: Wire the same guard into `PATCH /api/products/[id]`**

In `src/app/api/products/[id]/route.ts`, add the same import and, immediately after its existing `if (blocked) return blocked;` line, add the same two lines as Step 4.

- [ ] **Step 6: Wire the same guard into `POST /api/customers` and `PATCH /api/customers/[id]`**

Apply the identical import + two-line insertion (immediately after each handler's existing `if (blocked) return blocked;`) to `src/app/api/customers/route.ts`'s `POST` and `src/app/api/customers/[id]/route.ts`'s `PATCH`.

- [ ] **Step 7: Add the Owner-only guard and the `cashierCanManageCatalog` field to `PATCH /api/settings`**

In `src/app/api/settings/route.ts`, add the import:

```ts
import { assertOwnerRole } from "@/lib/rbac/require-owner";
```

In the `PATCH` handler, immediately after the existing `if (blocked) return blocked;` line, add:

```ts
  const forbidden = assertOwnerRole(session.user.role);
  if (forbidden) return forbidden;
```

Then add a new validation block after the existing `printFormat` check (after the `if (body.printFormat !== "THERMAL" && body.printFormat !== "A4") { ... }` block) and before the `await withTenant(...)` update call:

```ts
  if (typeof body.cashierCanManageCatalog !== "boolean") {
    return NextResponse.json({ error: "cashierCanManageCatalog must be a boolean" }, { status: 400 });
  }
```

Then update the `settings.update` call's `data` object from:

```ts
      data: { defaultVatRate: body.defaultVatRate, language: body.language, printFormat: body.printFormat },
```

to:

```ts
      data: {
        defaultVatRate: body.defaultVatRate,
        language: body.language,
        printFormat: body.printFormat,
        cashierCanManageCatalog: body.cashierCanManageCatalog,
      },
```

(`GET` is unchanged — it already spreads the full `Settings` row, which includes `cashierCanManageCatalog`.)

- [ ] **Step 8: Update every existing route test file's `mockSession` shape**

The role checks above make `session.user.role` load-bearing in five test files that currently mock a session without it. In each of the following files, change the `mockSession` type declaration from:

```ts
let mockSession: { user: { tenantId: string } } | null = null;
```

to:

```ts
let mockSession: { user: { tenantId: string; role: string } } | null = null;
```

— and add `role: "OWNER"` to every object literal that currently reads `{ user: { tenantId } }` or `{ user: { tenantId: otherTenantId } }` (these tests exercise the full-access path, so `OWNER` is correct):

**`src/app/api/products/route.test.ts`**: the `mockSession = { user: { tenantId } };` in `beforeAll`, the `mockSession = { user: { tenantId: otherTenantId } };` in "POST allows the same barcode across two different tenants...", and both `finally` blocks' `mockSession = { user: { tenantId } };` restores.

**`src/app/api/products/[id]/route.test.ts`**: the `mockSession = { user: { tenantId } };` in `beforeAll`, and the `finally` block's restore.

**`src/app/api/customers/route.test.ts`**: the `mockSession = { user: { tenantId } };` in `beforeAll`, the `mockSession = { user: { tenantId: otherTenantId } };` in "POST allows the same VAT ID across two different tenants", and all three `finally` blocks' restores.

**`src/app/api/customers/[id]/route.test.ts`**: the `mockSession = { user: { tenantId } };` in `beforeAll`, and the `finally` block's restore.

**`src/app/api/settings/route.test.ts`**: the `mockSession = { user: { tenantId } };` in `beforeAll`, and the `finally` block's restore in "PATCH returns 401 when unauthenticated".

Every occurrence becomes `{ user: { tenantId, role: "OWNER" } }` (or `{ user: { tenantId: otherTenantId, role: "OWNER" } }` for the two cross-tenant cases) — same tenant id, `role: "OWNER"` added.

- [ ] **Step 9: Add `cashierCanManageCatalog` to the three existing successful-PATCH test bodies in `settings/route.test.ts`**

In `src/app/api/settings/route.test.ts`, these three request bodies currently expect `200` but omit the now-required field — add `cashierCanManageCatalog: true` to each:

1. `"PATCH updates the tenant's settings"`: body becomes `{ defaultVatRate: "10", language: "en", printFormat: "THERMAL", phone: "", cashierCanManageCatalog: true }`
2. `"PATCH updates printFormat and phone"`: body becomes `{ defaultVatRate: "15", language: "ar", printFormat: "A4", phone: "+966501234567", cashierCanManageCatalog: true }`
3. `"PATCH clears the phone to null when an empty string is submitted"`: body becomes `{ defaultVatRate: "15", language: "ar", printFormat: "THERMAL", phone: "", cashierCanManageCatalog: true }`

The other PATCH tests (401, bad VAT, bad language, bad printFormat) all fail their own earlier validation before reaching the new check, so they need no change.

- [ ] **Step 10: Add new test cases for the catalog-toggle and Owner-only enforcement**

Add to `src/app/api/products/route.test.ts`, after the existing tests, inside the `describe` block:

```ts
  it("POST returns 403 for a Cashier when the Owner has turned off cashierCanManageCatalog", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/products", {
        method: "POST",
        body: JSON.stringify({ nameEn: "Cashier Blocked Product", unitPrice: "1" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });

  it("POST allows a Cashier when cashierCanManageCatalog is left at its default", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/products", {
        method: "POST",
        body: JSON.stringify({ nameEn: "Cashier Allowed Product", unitPrice: "1" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });
```

This file's `import { prisma } from "@/lib/db/client";` already exists — add `import { withTenant } from "@/lib/db/tenant-context";` if it is not already imported (it is, per the existing `beforeAll`).

Add to `src/app/api/customers/route.test.ts`, after the existing tests, inside the `describe` block:

```ts
  it("POST returns 403 for a Cashier when the Owner has turned off cashierCanManageCatalog", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/customers", {
        method: "POST",
        body: JSON.stringify({ name: "Cashier Blocked Customer" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });

  it("POST allows a Cashier when cashierCanManageCatalog is left at its default", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/customers", {
        method: "POST",
        body: JSON.stringify({ name: "Cashier Allowed Customer" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });
```

This file's `beforeAll` does not currently import `withTenant` for direct use beyond tenant/customer setup — it already does (`import { withTenant } from "@/lib/db/tenant-context";`), so no new import is needed.

Add to `src/app/api/settings/route.test.ts`, after the existing tests:

```ts
  it("PATCH returns 403 when the caller is a Cashier, not an Owner", async () => {
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ defaultVatRate: "10", language: "en", printFormat: "THERMAL", phone: "", cashierCanManageCatalog: true }),
      });
      const response = await PATCH(request);
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("PATCH persists cashierCanManageCatalog: false", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "15", language: "ar", printFormat: "THERMAL", phone: "", cashierCanManageCatalog: false }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const after = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
    expect(after.cashierCanManageCatalog).toBe(false);

    // Restore, since later tests in this file assume the default.
    await withTenant(tenantId, (tx) => tx.settings.update({ where: { tenantId }, data: { cashierCanManageCatalog: true } }));
  });
```

- [ ] **Step 11: Run the full products/customers/settings/users test files to verify everything passes**

Run: `npx vitest run src/app/api/products src/app/api/customers src/app/api/settings src/app/api/users src/lib/rbac`
Expected: PASS (every file, including the pre-existing tests that were touched only to add `role: "OWNER"`)

- [ ] **Step 12: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add src/lib/rbac/require-catalog-access.ts src/lib/rbac/require-catalog-access.test.ts src/app/api/products src/app/api/customers src/app/api/settings
git commit -m "Enforce Owner-only and catalog-toggle rules on the existing API routes"
```

---

## Task 4: Frontend gating — nav, sidebar, Products/Customers pages

**Files:**
- Modify: `src/components/shell/nav-items.ts`
- Modify: `src/components/shell/sidebar.tsx`
- Modify: `src/components/shell/app-shell.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/products/page.tsx`
- Modify: `src/components/products/products-client.tsx`
- Modify: `src/app/(app)/customers/page.tsx`
- Modify: `src/components/customers/customers-client.tsx`

**Interfaces:**
- Consumes: `session.user.role` (Task 1), `Settings.cashierCanManageCatalog` (existing field).
- Produces: `<Sidebar role>`, `<AppShell role>` props; `<ProductsClient canManageCatalog>`, `<CustomersClient canManageCatalog>` props — no other task consumes these further.

This task has no server-side logic to unit test — verification is a manual browser check (Step 8) plus the existing test suite/typecheck staying green.

- [ ] **Step 1: Add `ownerOnly` to the nav item shape and mark Settings**

In `src/components/shell/nav-items.ts`, change:

```ts
export interface NavItem {
  labelKey: keyof Dictionary["nav"];
  href: string | null; // null = visually present but not yet clickable ("coming soon")
}

export const NAV_ITEMS: NavItem[] = [
  { labelKey: "home", href: "/" },
  { labelKey: "newReceipt", href: "/receipts/new" },
  { labelKey: "newQuotation", href: "/quotations/new" },
  { labelKey: "products", href: "/products" },
  { labelKey: "customers", href: "/customers" },
  { labelKey: "receiptHistory", href: "/receipts" },
  { labelKey: "quotationHistory", href: "/quotations" },
  { labelKey: "settings", href: "/settings" },
];
```

to:

```ts
export interface NavItem {
  labelKey: keyof Dictionary["nav"];
  href: string | null; // null = visually present but not yet clickable ("coming soon")
  ownerOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { labelKey: "home", href: "/" },
  { labelKey: "newReceipt", href: "/receipts/new" },
  { labelKey: "newQuotation", href: "/quotations/new" },
  { labelKey: "products", href: "/products" },
  { labelKey: "customers", href: "/customers" },
  { labelKey: "receiptHistory", href: "/receipts" },
  { labelKey: "quotationHistory", href: "/quotations" },
  { labelKey: "settings", href: "/settings", ownerOnly: true },
];
```

- [ ] **Step 2: Filter the Settings link out of the Sidebar for a Cashier**

In `src/components/shell/sidebar.tsx`, change the function signature from:

```tsx
export function Sidebar({ tenantName }: { tenantName: string }) {
```

to:

```tsx
export function Sidebar({ tenantName, role }: { tenantName: string; role: string }) {
```

and change:

```tsx
      <nav className="flex flex-col">
        {NAV_ITEMS.map((item) => {
```

to:

```tsx
      <nav className="flex flex-col">
        {NAV_ITEMS.filter((item) => !item.ownerOnly || role === "OWNER").map((item) => {
```

- [ ] **Step 3: Pass `role` through `AppShell`**

In `src/components/shell/app-shell.tsx`, change:

```tsx
export function AppShell({
  tenantName,
  userEmail,
  children,
}: {
  tenantName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar tenantName={tenantName} />
```

to:

```tsx
export function AppShell({
  tenantName,
  userEmail,
  role,
  children,
}: {
  tenantName: string;
  userEmail: string;
  role: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar tenantName={tenantName} role={role} />
```

- [ ] **Step 4: Pass `role` from the layout**

In `src/app/(app)/layout.tsx`, change:

```tsx
    <AppShell tenantName={tenant.tradeNameEn} userEmail={session!.user.email ?? ""}>
```

to:

```tsx
    <AppShell tenantName={tenant.tradeNameEn} userEmail={session!.user.email ?? ""} role={session!.user.role}>
```

- [ ] **Step 5: Compute and pass `canManageCatalog` from the Products page**

In `src/app/(app)/products/page.tsx`, change:

```tsx
export default async function ProductsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const products = await withTenant(tenantId, (tx) => tx.product.findMany({ orderBy: { nameEn: "asc" } }));

  // Decimal fields (unitPrice, vatRate, quantity) can't cross the Server -> Client
  // Component boundary as raw Prisma Decimal instances -- convert to strings first.
  // See this plan's Global Constraints for why.
  const serialized = products.map((p) => ({
    ...p,
    unitPrice: p.unitPrice.toString(),
    vatRate: p.vatRate?.toString() ?? null,
    quantity: p.quantity.toString(),
  }));

  return <ProductsClient initialProducts={serialized} />;
}
```

to:

```tsx
export default async function ProductsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [products, settings] = await Promise.all([
    withTenant(tenantId, (tx) => tx.product.findMany({ orderBy: { nameEn: "asc" } })),
    withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } })),
  ]);
  const canManageCatalog = session!.user.role === "OWNER" || settings.cashierCanManageCatalog;

  // Decimal fields (unitPrice, vatRate, quantity) can't cross the Server -> Client
  // Component boundary as raw Prisma Decimal instances -- convert to strings first.
  // See this plan's Global Constraints for why.
  const serialized = products.map((p) => ({
    ...p,
    unitPrice: p.unitPrice.toString(),
    vatRate: p.vatRate?.toString() ?? null,
    quantity: p.quantity.toString(),
  }));

  return <ProductsClient initialProducts={serialized} canManageCatalog={canManageCatalog} />;
}
```

- [ ] **Step 6: Hide the mutation controls in `ProductsClient`**

In `src/components/products/products-client.tsx`, change the function signature from:

```tsx
export function ProductsClient({ initialProducts }: { initialProducts: SerializedProduct[] }) {
```

to:

```tsx
export function ProductsClient({
  initialProducts,
  canManageCatalog,
}: {
  initialProducts: SerializedProduct[];
  canManageCatalog: boolean;
}) {
```

Change the "Add Product" button from:

```tsx
        <Button variant="primary" onClick={() => setDialogState({ open: true, product: null })}>
          {dict.common.addProduct}
        </Button>
```

to:

```tsx
        {canManageCatalog && (
          <Button variant="primary" onClick={() => setDialogState({ open: true, product: null })}>
            {dict.common.addProduct}
          </Button>
        )}
```

Change the row actions cell from:

```tsx
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, product })}>
                        {dict.common.edit}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleActive(product)}>
                        {product.isActive ? dict.common.deactivate : dict.common.reactivate}
                      </Button>
                    </div>
                  </TableCell>
```

to:

```tsx
                  <TableCell className="text-right">
                    {canManageCatalog && (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, product })}>
                          {dict.common.edit}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleActive(product)}>
                          {product.isActive ? dict.common.deactivate : dict.common.reactivate}
                        </Button>
                      </div>
                    )}
                  </TableCell>
```

- [ ] **Step 7: Apply the same treatment to Customers**

In `src/app/(app)/customers/page.tsx`, change:

```tsx
export default async function CustomersPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const customers = await withTenant(tenantId, (tx) => tx.customer.findMany({ orderBy: { name: "asc" } }));

  return <CustomersClient initialCustomers={customers} />;
}
```

to:

```tsx
export default async function CustomersPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const [customers, settings] = await Promise.all([
    withTenant(tenantId, (tx) => tx.customer.findMany({ orderBy: { name: "asc" } })),
    withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } })),
  ]);
  const canManageCatalog = session!.user.role === "OWNER" || settings.cashierCanManageCatalog;

  return <CustomersClient initialCustomers={customers} canManageCatalog={canManageCatalog} />;
}
```

In `src/components/customers/customers-client.tsx`, change the function signature from:

```tsx
export function CustomersClient({ initialCustomers }: { initialCustomers: Customer[] }) {
```

to:

```tsx
export function CustomersClient({
  initialCustomers,
  canManageCatalog,
}: {
  initialCustomers: Customer[];
  canManageCatalog: boolean;
}) {
```

Change the "Add Customer" button from:

```tsx
        <Button variant="primary" onClick={() => setDialogState({ open: true, customer: null })}>
          + {dict.customers.dialogTitleAdd}
        </Button>
```

to:

```tsx
        {canManageCatalog && (
          <Button variant="primary" onClick={() => setDialogState({ open: true, customer: null })}>
            + {dict.customers.dialogTitleAdd}
          </Button>
        )}
```

Change the row actions cell from:

```tsx
                  <TableCell className="text-right">
                    {!customer.isWalkIn && (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, customer })}>
                          {dict.common.edit}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleActive(customer)}>
                          {customer.isActive ? dict.common.deactivate : dict.common.reactivate}
                        </Button>
                      </div>
                    )}
                  </TableCell>
```

to:

```tsx
                  <TableCell className="text-right">
                    {!customer.isWalkIn && canManageCatalog && (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, customer })}>
                          {dict.common.edit}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleActive(customer)}>
                          {customer.isActive ? dict.common.deactivate : dict.common.reactivate}
                        </Button>
                      </div>
                    )}
                  </TableCell>
```

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS. (No test file asserts on `NAV_ITEMS`, `Sidebar`, `AppShell`, `ProductsClient`, or `CustomersClient` directly, so this step is verification that nothing else broke, not new test coverage — Task 4's own correctness is confirmed manually in Step 9 below and in this plan's final manual verification.)

- [ ] **Step 9: Commit**

```bash
git add src/components/shell/nav-items.ts src/components/shell/sidebar.tsx src/components/shell/app-shell.tsx "src/app/(app)/layout.tsx" "src/app/(app)/products/page.tsx" src/components/products/products-client.tsx "src/app/(app)/customers/page.tsx" src/components/customers/customers-client.tsx
git commit -m "Hide Owner-only nav and catalog-management controls from Cashiers"
```

---

## Task 5: Settings restructure, Staff section, password checklist, i18n

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`
- Create: `src/components/settings/settings-client.tsx`
- Create: `src/components/settings/password-checklist.tsx`
- Create: `src/components/settings/staff-section.tsx`
- Modify: `src/lib/i18n/dictionaries/dictionary.types.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`
- Modify: `src/lib/i18n/dictionaries/ar.ts`

**Interfaces:**
- Consumes: `POST /api/users`, `PATCH /api/users/[id]` (Task 2), `PATCH /api/settings` with `cashierCanManageCatalog` (Task 3), `PASSWORD_RULES`/`isPasswordValid` (Task 2), `session.user.role` (Task 1).
- Produces: nothing further consumed by another task — this is the last task in the plan.

- [ ] **Step 1: Add the new dictionary keys**

In `src/lib/i18n/dictionaries/dictionary.types.ts`, add `cashierCanManageCatalog: string;` to the end of the `settings` block (after `saveChanges: string;`), and add a new top-level `staff` block after `printChrome` and before `billing`:

```ts
  staff: {
    title: string;
    addCashier: string;
    noCashiersYet: string;
    email: string;
    password: string;
    dialogTitle: string;
    activeBadge: string;
    inactiveBadge: string;
    passwordRules: {
      minLength: string;
      uppercase: string;
      number: string;
      special: string;
    };
  };
```

In `src/lib/i18n/dictionaries/en.ts`, add `cashierCanManageCatalog: "Cashiers can add, edit, and deactivate products and customers",` at the end of the `settings` block, and add the matching `staff` block in the same position (after `printChrome`, before `billing`):

```ts
  staff: {
    title: "Staff",
    addCashier: "+ Add Cashier",
    noCashiersYet: "No cashiers yet — add your first one",
    email: "Email",
    password: "Password",
    dialogTitle: "Add Cashier",
    activeBadge: "Active",
    inactiveBadge: "Inactive",
    passwordRules: {
      minLength: "At least 8 characters",
      uppercase: "One uppercase letter",
      number: "One number",
      special: "One special character",
    },
  },
```

In `src/lib/i18n/dictionaries/ar.ts`, add `cashierCanManageCatalog: "يمكن للكاشير إضافة وتعديل وإيقاف المنتجات والعملاء",` at the end of the `settings` block, and add the matching `staff` block in the same position:

```ts
  staff: {
    title: "الموظفون",
    addCashier: "+ إضافة كاشير",
    noCashiersYet: "لا يوجد كاشير بعد — أضف أول واحد",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    dialogTitle: "إضافة كاشير",
    activeBadge: "نشط",
    inactiveBadge: "موقوف",
    passwordRules: {
      minLength: "8 أحرف على الأقل",
      uppercase: "حرف كبير واحد",
      number: "رقم واحد",
      special: "رمز خاص واحد",
    },
  },
```

- [ ] **Step 2: Run the dictionary parity test to verify `en`/`ar` stay in sync**

Run: `npx vitest run src/lib/i18n/dictionaries/dictionary-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Move the existing Settings form into its own client component and add the catalog toggle**

Create `src/components/settings/settings-client.tsx` with the current content of `src/app/(app)/settings/page.tsx`, renamed to a named export, with the new checkbox added:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/language-provider";

export function SettingsClient() {
  const { dict } = useLocale();
  const [defaultVatRate, setDefaultVatRate] = useState("15");
  const [language, setLanguage] = useState("ar");
  const [printFormat, setPrintFormat] = useState("THERMAL");
  const [phone, setPhone] = useState("");
  const [cashierCanManageCatalog, setCashierCanManageCatalog] = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDefaultVatRate(data.defaultVatRate);
        setLanguage(data.language);
        setPrintFormat(data.printFormat);
        setPhone(data.phone ?? "");
        setCashierCanManageCatalog(data.cashierCanManageCatalog);
      });
  }, []);

  async function handleSave() {
    await fetch("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate, language, printFormat, phone, cashierCanManageCatalog }),
    });
  }

  return (
    <Card className="max-w-md border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">{dict.settings.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="vat" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.settings.defaultVatRate}
          </Label>
          <Input id="vat" value={defaultVatRate} onChange={(e) => setDefaultVatRate(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="lang" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.settings.language}
          </Label>
          <select
            id="lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
          <p className="mt-1.5 text-xs text-muted-fg">{dict.settings.languageCaption}</p>
        </div>

        <div>
          <Label htmlFor="phone" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.settings.businessPhone}
          </Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966 5X XXX XXXX" />
        </div>

        <div>
          <Label
            htmlFor="printFormat"
            className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg"
          >
            {dict.settings.printFormat}
          </Label>
          <select
            id="printFormat"
            value={printFormat}
            onChange={(e) => setPrintFormat(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="THERMAL">{dict.settings.thermal}</option>
            <option value="A4">{dict.settings.a4}</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-body">
          <Checkbox
            checked={cashierCanManageCatalog}
            onCheckedChange={(checked) => setCashierCanManageCatalog(checked === true)}
          />
          {dict.settings.cashierCanManageCatalog}
        </label>

        <Button onClick={handleSave} variant="primary">
          {dict.settings.saveChanges}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write the password checklist component**

Create `src/components/settings/password-checklist.tsx`:

```tsx
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
```

- [ ] **Step 5: Write the Staff section (list + Add Cashier dialog)**

Create `src/components/settings/staff-section.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/language-provider";
import { isPasswordValid } from "@/lib/auth/password-rules";
import { PasswordChecklist } from "./password-checklist";

interface Cashier {
  id: string;
  email: string;
  isActive: boolean;
}

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function StaffSection({ initialCashiers }: { initialCashiers: Cashier[] }) {
  const { dict } = useLocale();
  const [cashiers, setCashiers] = useState(initialCashiers);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openDialog() {
    setEmail("");
    setPassword("");
    setError(null);
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/users", { method: "POST", body: JSON.stringify({ email, password }) });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      setCashiers((prev) => [...prev, body]);
      setDialogOpen(false);
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(cashier: Cashier) {
    setActionError(null);
    try {
      const response = await fetch(`/api/users/${cashier.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !cashier.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setCashiers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      setActionError(dict.common.somethingWentWrong);
    }
  }

  const canSubmit = email.trim() !== "" && isPasswordValid(password);

  return (
    <Card className="max-w-md border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-base font-medium text-heading">{dict.staff.title}</h2>
        <Button variant="primary" size="sm" onClick={openDialog}>
          {dict.staff.addCashier}
        </Button>
      </div>

      {actionError && (
        <p role="alert" className="mb-3 text-xs text-red-600">
          {actionError}
        </p>
      )}

      {cashiers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-fg">{dict.staff.noCashiersYet}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{dict.staff.email}</TableHead>
              <TableHead className="text-right">{dict.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cashiers.map((cashier) => (
              <TableRow key={cashier.id} className={!cashier.isActive ? "opacity-50" : undefined}>
                <TableCell>
                  {cashier.email}
                  <Badge variant={cashier.isActive ? "secondary" : "outline"} className="ms-2">
                    {cashier.isActive ? dict.staff.activeBadge : dict.staff.inactiveBadge}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => toggleActive(cashier)}>
                    {cashier.isActive ? dict.common.deactivate : dict.common.reactivate}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.staff.dialogTitle}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <div>
              <Label htmlFor="cashier-email" className={LABEL_CLASS}>
                {dict.staff.email}
              </Label>
              <Input id="cashier-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div>
              <Label htmlFor="cashier-password" className={LABEL_CLASS}>
                {dict.staff.password}
              </Label>
              <Input
                id="cashier-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <div className="mt-2">
                <PasswordChecklist password={password} />
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" variant="primary" disabled={saving || !canSubmit}>
                {saving ? dict.common.savingEllipsis : dict.common.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 6: Restructure the Settings page into a server component with the Owner-only redirect**

Replace the full content of `src/app/(app)/settings/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { SettingsClient } from "@/components/settings/settings-client";
import { StaffSection } from "@/components/settings/staff-section";

export default async function SettingsPage() {
  const session = await auth();
  if (session!.user.role !== "OWNER") {
    redirect("/");
  }
  const tenantId = session!.user.tenantId;

  const cashiers = await withTenant(tenantId, (tx) =>
    tx.user.findMany({ where: { role: "CASHIER" }, orderBy: { email: "asc" } })
  );

  return (
    <div className="flex flex-col gap-6">
      <SettingsClient />
      <StaffSection initialCashiers={cashiers.map((c) => ({ id: c.id, email: c.email, isActive: c.isActive }))} />
    </div>
  );
}
```

- [ ] **Step 7: Run the full test suite, typecheck, and lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 8: Manually verify in the browser**

Start the dev server and, using the seeded Owner (`owner@demo.local` / `changeme123`):
1. Open `/settings` — confirm the new "Staff" card renders below the existing settings card, empty state showing.
2. Click "+ Add Cashier", type an email and a password one character at a time — confirm each checklist row (8 chars, uppercase, number, special character) flips to a green check independently as its rule becomes true, and the Save button stays disabled until all four are satisfied and email is non-empty.
3. Submit a valid Cashier — confirm it appears in the table with an Active badge.
4. Sign out, sign back in as that new Cashier — confirm: Settings is absent from the sidebar, and navigating directly to `/settings` redirects to Home. Confirm Products/Customers pages are reachable and show the Add/Edit/Deactivate controls (catalog toggle defaults to on).
5. Sign back in as the Owner, open Settings, uncheck "Cashiers can add, edit, and deactivate products and customers", save. Sign in as the Cashier again — confirm Products/Customers are still viewable/searchable but the Add/Edit/Deactivate controls are now gone.
6. As the Owner, deactivate the Cashier from the Staff table — confirm the badge flips to Inactive, then confirm that Cashier's login now fails.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/settings/page.tsx" src/components/settings src/lib/i18n/dictionaries
git commit -m "Add the Owner-only Staff section with an interactive password checklist"
```

---

## Final Verification

After all five tasks are complete, run the full suite once more from a clean state (`npx vitest run && npx tsc --noEmit && npm run lint`) and repeat the manual browser walkthrough from Task 5, Step 8, end to end, before handing off to `finishing-a-development-branch`.
