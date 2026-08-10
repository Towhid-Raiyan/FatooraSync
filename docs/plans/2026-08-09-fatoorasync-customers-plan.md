# FatooraSync Customers Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship full CRUD for Customers — API routes, list page, search, active/inactive toggle, add/edit dialog — as the first of three planned feature builds on top of the design system foundation.

**Architecture:** Next.js Route Handlers under `src/app/api/customers/` (list+create, and a `[id]` route for update), following the exact pattern already established by `/api/settings`. The `/customers` page is a Server Component that fetches the initial list via `withTenant` (same pattern as the Home dashboard), handing it to a Client Component that owns search/filter/dialog state entirely client-side — no re-fetch on every keystroke or toggle.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma, Tailwind CSS v4, shadcn/ui (adding Dialog, Table, Checkbox, Badge to the existing Button/Input/Label/Card set).

## Global Constraints

- Design source of truth: `docs/specs/2026-08-09-fatoorasync-customers-design.md` — every field name, endpoint shape, and UI behavior in this plan is copied from there. If anything here seems to conflict with that spec, the spec governs; flag the conflict rather than guessing.
- No `DELETE` endpoint anywhere in this plan. "Deleting" a customer is always `PATCH { isActive: false }` — historical documents must keep referencing a real row.
- The Walk-in Customer (`isWalkIn: true`) is locked: the `PATCH` route rejects any edit/deactivate/reactivate targeting it with a 403, regardless of what the UI does — this is a server-side guarantee, not just a hidden button. The UI additionally renders no Edit/Deactivate/Reactivate actions for that row.
- VAT ID uniqueness is per-tenant (already enforced by the DB's `@@unique([tenantId, vatId])`), and multiple customers with no VAT ID (`null`) are always allowed — Postgres does not treat `NULL` as equal to `NULL` in a unique index.
- Reuse the design system's existing tokens and patterns exactly: `variant="primary"` on `Button` for the page's one primary action ("+ Add Customer" — never duplicated elsewhere on the page), the label treatment `text-[10.5px] font-bold uppercase tracking-wider text-muted-fg`, the card shadow `shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]` and `border border-border-subtle` already used on Home and Settings, `text-heading`/`text-body`/`text-muted-fg` for text color roles.
- Testing: route-handler tests only (`vitest`, following `src/app/api/settings/route.test.ts`'s exact harness — mocked `auth()`, a real tenant + real DB rows created in `beforeAll`/cleaned in `afterAll`). No new UI test tooling is introduced; the frontend is verified by manual browser testing during implementation, matching how the design system plan's pages were verified. The tenant-isolation test (customer A's tenant can never see/touch customer B's tenant's data) is mandatory for every route, per the MVP spec calling this "the single most important test in a multi-tenant system."
- Not in this plan: autocomplete/typeahead customer search for the Sales Receipt screen, and auto-creating a customer from a new VAT ID on receipt save — both belong to the future Sales Receipt plan.

---

## File Structure

```
src/
  app/
    api/
      customers/
        route.ts                (create: GET list, POST create)
        route.test.ts             (create)
        [id]/
          route.ts                 (create: PATCH update/deactivate/reactivate)
          route.test.ts             (create)
    (app)/
      customers/
        page.tsx                  (create: Server Component, initial fetch)
  components/
    customers/
      customers-client.tsx        (create: list, search, toggle, table)
      customer-form-dialog.tsx    (create: add/edit modal)
    shell/
      nav-items.ts                 (modify: Customers href null -> /customers)
    ui/                            (create via shadcn CLI: dialog.tsx, table.tsx, checkbox.tsx, badge.tsx)
```

---

### Task 1: Install shadcn primitives (Dialog, Table, Checkbox, Badge) and enable the Customers nav link

**Files:**
- Create: `src/components/ui/dialog.tsx`, `src/components/ui/table.tsx`, `src/components/ui/checkbox.tsx`, `src/components/ui/badge.tsx` (via shadcn CLI)
- Modify: `src/components/shell/nav-items.ts`

**Interfaces:**
- Produces: shadcn `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Checkbox`, and `Badge` components from `@/components/ui/*`, used by Task 4.

- [ ] **Step 1: Install the components**

```bash
npx shadcn@latest add dialog table checkbox badge
```

This project already has `components.json` configured (style `radix-nova`, base color `neutral`) from the design system plan — the CLI reuses that config, no prompts expected.

- [ ] **Step 2: Verify what was generated**

Run: `ls src/components/ui/dialog.tsx src/components/ui/table.tsx src/components/ui/checkbox.tsx src/components/ui/badge.tsx`
Expected: all four files exist.

Open each file and note its actual exported component names and prop shapes (e.g. confirm `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter` all exist in `dialog.tsx`; confirm `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` in `table.tsx`; confirm `Checkbox` takes `checked`/`onCheckedChange` props in `checkbox.tsx`; confirm `Badge`'s available `variant` values in `badge.tsx`) — Task 4 assumes these exact names and prop shapes. If the installed version differs, use the real names/props and note the difference in your report; the later task's code samples may need small adjustments to match.

- [ ] **Step 3: Enable the Customers nav link**

In `src/components/shell/nav-items.ts`, change:

```typescript
{ label: "Customers", href: null },
```

to:

```typescript
{ label: "Customers", href: "/customers" },
```

- [ ] **Step 4: Verify it builds**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: succeeds. (There's no `/customers` page yet — the link will 404 if clicked before Task 4 ships, which is fine for this task; it only enables the link.)

- [ ] **Step 5: Commit**

```bash
git add components.json src/components/ui/dialog.tsx src/components/ui/table.tsx src/components/ui/checkbox.tsx src/components/ui/badge.tsx src/components/shell/nav-items.ts package.json package-lock.json
git commit -m "Add shadcn dialog, table, checkbox, and badge; enable the Customers nav link"
```

---

### Task 2: Customer list and create API

**Files:**
- Create: `src/app/api/customers/route.ts`
- Create: `src/app/api/customers/route.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth/config`, `withTenant` from `@/lib/db/tenant-context`.
- Produces: `GET /api/customers` (returns `Customer[]`, sorted by name), `POST /api/customers` (creates and returns a `Customer`, 201). Both used by Task 4's page/dialog via `fetch`.

- [ ] **Step 1: Create the route**

Create `src/app/api/customers/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;

  const customers = await withTenant(tenantId, (tx) =>
    tx.customer.findMany({ orderBy: { name: "asc" } })
  );
  return NextResponse.json(customers);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const body = await request.json();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  try {
    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.create({
        // `tenantId` is intentionally absent here — withTenant()'s Prisma extension injects it
        // at runtime. But the extension can't loosen the *type* Prisma generates for `create`,
        // which still requires `tenantId` (or a `tenant: { connect }` relation) in `data` at
        // compile time. The cast documents that this is a known, safe gap between the runtime
        // guarantee and the static type, not a missing field.
        data: {
          name,
          vatId: body.vatId || null,
          crNumber: body.crNumber || null,
          phone: body.phone || null,
          address: body.address || null,
        } as Prisma.CustomerUncheckedCreateInput,
      })
    );
    return NextResponse.json(customer, { status: 201 });
  } catch (err) {
    // Customer's only unique constraint besides its id is @@unique([tenantId, vatId]),
    // so any P2002 from this create is necessarily a duplicate VAT ID within this tenant.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "This VAT ID is already used by another customer" },
        { status: 409 }
      );
    }
    throw err;
  }
}
```

- [ ] **Step 2: Create the test file**

Create `src/app/api/customers/route.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET, POST } from "./route";

let tenantId: string;
let otherTenantId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("/api/customers", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Customers Test Co", tradeNameEn: "Customers Test Shop", vatNumber: "300000000000013" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Co", tradeNameEn: "Other Shop", vatNumber: "300000000000020" },
    });
    otherTenantId = otherTenant.id;
    // The `as Prisma.CustomerUncheckedCreateInput` cast here and on every other direct
    // tx.customer.create() call below documents a known gap: withTenant()'s Prisma extension
    // injects tenantId at runtime, but can't loosen the type Prisma generates for `create`,
    // which still requires tenantId (or a tenant relation) in `data` at compile time.
    await withTenant(otherTenantId, (tx) =>
      tx.customer.create({ data: { name: "Other Tenant's Customer" } as Prisma.CustomerUncheckedCreateInput })
    );
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("POST creates a customer with valid data", async () => {
    const request = new Request("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Acme Trading", vatId: "300000000000037", phone: "0555555555" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe("Acme Trading");
    expect(body.vatId).toBe("300000000000037");
  });

  it("GET returns only this tenant's customers, never another tenant's", async () => {
    const response = await GET();
    const body = await response.json();
    const names = body.map((c: { name: string }) => c.name);
    expect(names).toContain("Acme Trading");
    expect(names).not.toContain("Other Tenant's Customer");
  });

  it("POST returns 400 for an empty name", async () => {
    const request = new Request("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("POST returns 409 for a VAT ID already used within the same tenant", async () => {
    const request = new Request("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Duplicate Vat Co", vatId: "300000000000037" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
  });

  it("POST allows the same VAT ID across two different tenants", async () => {
    mockSession = { user: { tenantId: otherTenantId } };
    try {
      const request = new Request("http://localhost/api/customers", {
        method: "POST",
        body: JSON.stringify({ name: "Cross Tenant Same Vat", vatId: "300000000000037" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("POST allows multiple customers with no VAT ID", async () => {
    const first = await POST(
      new Request("http://localhost/api/customers", { method: "POST", body: JSON.stringify({ name: "No Vat One" }) })
    );
    const second = await POST(
      new Request("http://localhost/api/customers", { method: "POST", body: JSON.stringify({ name: "No Vat Two" }) })
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("GET returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET();
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("POST returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const request = new Request("http://localhost/api/customers", {
        method: "POST",
        body: JSON.stringify({ name: "Should Not Be Created" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test -- customers/route.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/customers/route.ts src/app/api/customers/route.test.ts
git commit -m "Add the customer list and create API"
```

---

### Task 3: Customer update API (edit, deactivate, reactivate, walk-in guard)

**Files:**
- Create: `src/app/api/customers/[id]/route.ts`
- Create: `src/app/api/customers/[id]/route.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth/config`, `withTenant` from `@/lib/db/tenant-context`.
- Produces: `PATCH /api/customers/[id]` (partial update; accepts any of `name`, `vatId`, `crNumber`, `phone`, `address`, `isActive`; returns the updated `Customer`). Used by Task 4's dialog (edit) and row actions (deactivate/reactivate).

- [ ] **Step 1: Create the route**

Create `src/app/api/customers/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const { id } = await params;
  const body = await request.json();

  const existing = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id } }));
  if (!existing) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  if (existing.isWalkIn) {
    return NextResponse.json({ error: "The Walk-in Customer cannot be edited" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    data.name = name;
  }
  if (body.vatId !== undefined) data.vatId = body.vatId || null;
  if (body.crNumber !== undefined) data.crNumber = body.crNumber || null;
  if (body.phone !== undefined) data.phone = body.phone || null;
  if (body.address !== undefined) data.address = body.address || null;
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

  try {
    const customer = await withTenant(tenantId, (tx) => tx.customer.update({ where: { id }, data }));
    return NextResponse.json(customer);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "This VAT ID is already used by another customer" },
        { status: 409 }
      );
    }
    throw err;
  }
}
```

- [ ] **Step 2: Create the test file**

Create `src/app/api/customers/[id]/route.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { PATCH } from "./route";

let tenantId: string;
let otherTenantId: string;
let customerId: string;
let walkInId: string;
let otherTenantCustomerId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/customers/x", { method: "PATCH", body: JSON.stringify(body) });
}

describe("/api/customers/[id]", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Customer Patch Test Co", tradeNameEn: "Customer Patch Shop", vatNumber: "300000000000044" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };

    // The `as Prisma.CustomerUncheckedCreateInput` cast on every direct tx.customer.create()
    // call in this file documents a known gap: withTenant()'s Prisma extension injects
    // tenantId at runtime, but can't loosen the type Prisma generates for `create`, which
    // still requires tenantId (or a tenant relation) in `data` at compile time.
    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Editable Customer", phone: "0500000000" } as Prisma.CustomerUncheckedCreateInput })
    );
    customerId = customer.id;

    const walkIn = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    walkInId = walkIn.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Patch Co", tradeNameEn: "Other Patch Shop", vatNumber: "300000000000051" },
    });
    otherTenantId = otherTenant.id;
    const otherCustomer = await withTenant(otherTenantId, (tx) =>
      tx.customer.create({ data: { name: "Other Tenant Customer" } as Prisma.CustomerUncheckedCreateInput })
    );
    otherTenantCustomerId = otherCustomer.id;
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("updates an editable customer's fields", async () => {
    const response = await PATCH(patchRequest({ name: "Renamed Customer", phone: "0511111111" }), {
      params: Promise.resolve({ id: customerId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Renamed Customer");
    expect(body.phone).toBe("0511111111");
  });

  it("deactivates then reactivates a customer", async () => {
    const deactivate = await PATCH(patchRequest({ isActive: false }), {
      params: Promise.resolve({ id: customerId }),
    });
    expect(deactivate.status).toBe(200);
    expect((await deactivate.json()).isActive).toBe(false);

    const reactivate = await PATCH(patchRequest({ isActive: true }), {
      params: Promise.resolve({ id: customerId }),
    });
    expect(reactivate.status).toBe(200);
    expect((await reactivate.json()).isActive).toBe(true);
  });

  it("returns 403 when targeting the Walk-in Customer", async () => {
    const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: walkInId }) });
    expect(response.status).toBe(403);
  });

  it("returns 404 for a nonexistent id", async () => {
    const response = await PATCH(patchRequest({ name: "Nope" }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for a customer belonging to another tenant", async () => {
    const response = await PATCH(patchRequest({ name: "Should not work" }), {
      params: Promise.resolve({ id: otherTenantCustomerId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 400 when clearing the name to empty", async () => {
    const response = await PATCH(patchRequest({ name: "   " }), { params: Promise.resolve({ id: customerId }) });
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await PATCH(patchRequest({ name: "Nope" }), { params: Promise.resolve({ id: customerId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test -- customers`
Expected: all tests in both `customers/route.test.ts` and `customers/[id]/route.test.ts` pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/customers/\[id\]/route.ts src/app/api/customers/\[id\]/route.test.ts
git commit -m "Add the customer update API with the walk-in customer guard"
```

---

### Task 4: Customers page — list, search, active/inactive toggle, add/edit dialog

**Files:**
- Create: `src/app/(app)/customers/page.tsx`
- Create: `src/components/customers/customers-client.tsx`
- Create: `src/components/customers/customer-form-dialog.tsx`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth/config`, `withTenant` from `@/lib/db/tenant-context` (in `page.tsx`); `GET/POST /api/customers` and `PATCH /api/customers/[id]` (Tasks 2 and 3, via `fetch` in the client components); `Button`/`Input`/`Label`/`Card`/`Dialog`-family/`Table`-family/`Checkbox`/`Badge` from `@/components/ui/*` (Task 1). Automatically wrapped by the `(app)` layout's `AppShell`.

- [ ] **Step 1: Create the page (Server Component)**

Create `src/app/(app)/customers/page.tsx`:

```tsx
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { CustomersClient } from "@/components/customers/customers-client";

export default async function CustomersPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;

  const customers = await withTenant(tenantId, (tx) => tx.customer.findMany({ orderBy: { name: "asc" } }));

  return <CustomersClient initialCustomers={customers} />;
}
```

- [ ] **Step 2: Create the client component**

Create `src/components/customers/customers-client.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { CustomerFormDialog } from "./customer-form-dialog";

export function CustomersClient({ initialCustomers }: { initialCustomers: Customer[] }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogState, setDialogState] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (!showInactive && !c.isActive) return false;
      if (!query) return true;
      return (
        c.name.toLowerCase().includes(query) ||
        (c.vatId ?? "").toLowerCase().includes(query) ||
        (c.phone ?? "").toLowerCase().includes(query)
      );
    });
  }, [customers, search, showInactive]);

  const hasAnyRealCustomer = customers.some((c) => !c.isWalkIn);

  function handleSaved(customer: Customer) {
    setCustomers((prev) => {
      const exists = prev.some((c) => c.id === customer.id);
      return exists ? prev.map((c) => (c.id === customer.id ? customer : c)) : [...prev, customer];
    });
    setDialogState({ open: false, customer: null });
  }

  async function toggleActive(customer: Customer) {
    const response = await fetch(`/api/customers/${customer.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !customer.isActive }),
    });
    if (response.ok) {
      const updated = await response.json();
      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search by name, VAT ID, or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
          <label className="flex items-center gap-2 text-sm text-body">
            <Checkbox checked={showInactive} onCheckedChange={(checked) => setShowInactive(checked === true)} />
            Show inactive
          </label>
        </div>
        <Button variant="primary" onClick={() => setDialogState({ open: true, customer: null })}>
          + Add Customer
        </Button>
      </div>

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {!hasAnyRealCustomer ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">No customers yet — add your first one</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>VAT ID</TableHead>
                <TableHead>CR Number</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((customer) => (
                <TableRow key={customer.id} className={!customer.isActive ? "opacity-50" : undefined}>
                  <TableCell className="font-medium text-heading">
                    {customer.name}
                    {customer.isWalkIn && (
                      <Badge variant="secondary" className="ms-2">
                        System
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{customer.vatId ?? "—"}</TableCell>
                  <TableCell>{customer.crNumber ?? "—"}</TableCell>
                  <TableCell>{customer.phone ?? "—"}</TableCell>
                  <TableCell>{customer.address ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {!customer.isWalkIn && (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, customer })}>
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleActive(customer)}>
                          {customer.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <CustomerFormDialog
        open={dialogState.open}
        customer={dialogState.customer}
        onOpenChange={(open) => setDialogState((s) => ({ ...s, open }))}
        onSaved={handleSaved}
      />
    </div>
  );
}
```

Note on the empty state: it replaces the *entire* table area, including the Walk-in Customer row — a fresh tenant with zero real customers sees only the "No customers yet" message, not a table with just the system row in it. This matches the design spec's "table area is replaced with a centered message."

Note on the empty state's action button: the design spec's frontend section describes the empty state as showing its own "+ Add Customer" button alongside the message. That reads naturally in isolation, but the toolbar's "+ Add Customer" button is never hidden (it isn't conditioned on `hasAnyRealCustomer`), so following the spec literally puts two identical primary buttons on screen at once — directly contradicting this plan's own Global Constraint that a page's primary action lives in exactly one place, never duplicated. The toolbar button already covers the empty-state case (it's visible and functional with zero customers), so the empty state renders the message only, no second button. This plan's Global Constraint governs over the spec's literal empty-state wording here — an unambiguous resolution, not a design trade-off to leave open.

- [ ] **Step 3: Create the dialog component**

Create `src/components/customers/customer-form-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@prisma/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CustomerFormDialogProps {
  open: boolean;
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (customer: Customer) => void;
}

const EMPTY_FORM = { name: "", vatId: "", crNumber: "", phone: "", address: "" };
const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function CustomerFormDialog({ open, customer, onOpenChange, onSaved }: CustomerFormDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        customer
          ? {
              name: customer.name,
              vatId: customer.vatId ?? "",
              crNumber: customer.crNumber ?? "",
              phone: customer.phone ?? "",
              address: customer.address ?? "",
            }
          : EMPTY_FORM
      );
      setError(null);
    }
  }, [open, customer]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = customer ? `/api/customers/${customer.id}` : "/api/customers";
    const method = customer ? "PATCH" : "POST";

    const response = await fetch(url, { method, body: JSON.stringify(form) });
    const body = await response.json();
    setSaving(false);

    if (!response.ok) {
      setError(body.error ?? "Something went wrong");
      return;
    }
    onSaved(body);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{customer ? "Edit Customer" : "Add Customer"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div>
            <Label htmlFor="customer-name" className={LABEL_CLASS}>
              Name
            </Label>
            <Input
              id="customer-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="customer-vat" className={LABEL_CLASS}>
              VAT ID
            </Label>
            <Input id="customer-vat" value={form.vatId} onChange={(e) => setForm({ ...form, vatId: e.target.value })} />
          </div>

          <div>
            <Label htmlFor="customer-cr" className={LABEL_CLASS}>
              CR Number
            </Label>
            <Input
              id="customer-cr"
              value={form.crNumber}
              onChange={(e) => setForm({ ...form, crNumber: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="customer-phone" className={LABEL_CLASS}>
              Phone
            </Label>
            <Input id="customer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>

          <div>
            <Label htmlFor="customer-address" className={LABEL_CLASS}>
              Address
            </Label>
            <Input
              id="customer-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run typecheck`
Expected: no errors. If Task 1's actual generated component names/props differ from what's assumed above (e.g. `Checkbox`'s change-event prop, `Badge`'s variant names), adjust to match what Task 1's report documented.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, log in (`owner@demo.local` / `changeme123`), navigate to `/customers` (now enabled in the sidebar).

Expected:
- The Walk-in Customer row renders with a "System" badge and no Edit/Deactivate buttons.
- "+ Add Customer" opens the dialog; creating a customer with just a name succeeds and appears in the table.
- Creating a second customer with a VAT ID that duplicates an existing one shows the inline "already used by another customer" error and does not close the dialog.
- Editing a customer via its row's "Edit" button pre-fills the dialog and saves changes.
- "Deactivate" on a real customer grays out its row and removes it from the default (active-only) view; toggling "Show inactive" reveals it again with a "Reactivate" button.
- The search box filters rows by name/VAT ID/phone as you type, with no network request per keystroke (check the Network tab — only the initial page load and the actual create/edit/toggle actions should hit the network, not search).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/customers/page.tsx src/components/customers
git commit -m "Add the customers list page with search, filtering, and the add/edit dialog"
```
