# FatooraSync Products Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship full CRUD for Products — API routes, list page, search, active/inactive toggle, add/edit dialog — the second of three planned feature builds on top of the design system foundation (Customers shipped first, Sales Receipt & Quotation is next).

**Architecture:** Next.js Route Handlers under `src/app/api/products/` (list+create, and a `[id]` route for update), following the exact pattern `/api/customers` already established. The `/products` page is a Server Component that fetches the initial list via `withTenant`, hands it to a Client Component that owns search/filter/sort/dialog state entirely client-side. All shadcn UI primitives this plan needs (`Dialog`, `Table`, `Checkbox`, `Badge`, plus the existing `Button`/`Input`/`Label`/`Card`) are already installed from the Customers plan — no new component installation required.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma, Tailwind CSS v4, shadcn/ui (existing components, no new installs).

## Global Constraints

- Design source of truth: `docs/specs/2026-08-10-fatoorasync-products-design.md` — every field name, endpoint shape, and UI behavior in this plan is copied from there. If anything here seems to conflict with that spec, the spec governs; flag the conflict rather than guessing.
- No `DELETE` endpoint anywhere in this plan. "Deleting" a product is always `PATCH { isActive: false }`.
- Product has **two independent** per-tenant unique constraints (`sku`, `barcode`) — never assume a single "any P2002 means X" shortcut like Customer's routes use. Both `POST` and `PATCH` do a proactive lookup before writing so the error response can name the specific field that collided.
- `vatRate` is nullable: `null` means "use the tenant's default VAT rate," any set value (including `0`) is an explicit override. The UI represents this as a "Use default VAT rate" toggle, not a plain optional number field.
- `quantity` is directly editable in the Add/Edit form on both create and edit — there's no separate stock-adjustment tooling yet.
- **Prisma `Decimal` fields cannot cross the Server Component → Client Component prop boundary as raw values.** `Product.unitPrice`, `vatRate`, and `quantity` are all `Decimal` in the schema. Unlike Customer (which has no Decimal fields) or Home (which only passes `.count()` results, plain numbers), this is the first screen in the codebase where Decimal fields need to reach a Client Component as props — React Server Components' serialization format does not support arbitrary class instances like Prisma's `Decimal`, and passing one directly as a prop will throw at runtime. The Server Component (`page.tsx`) must convert `unitPrice`/`vatRate`/`quantity` to plain strings (`.toString()`) before passing the list to the Client Component. This is *not* a concern for the API routes themselves — `NextResponse.json()` goes through real `JSON.stringify`, which correctly calls `Decimal`'s own `toJSON()` method, so `fetch` responses already arrive as strings with no special handling needed.
- Reuse the design system's existing tokens and patterns exactly: `variant="primary"` on `Button` for the page's one primary action ("+ Add Product" — never duplicated elsewhere on the page, including the empty state), the label treatment `text-[10.5px] font-bold uppercase tracking-wider text-muted-fg`, the card shadow `shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]` and `border border-border-subtle`, `text-heading`/`text-body`/`text-muted-fg` for text roles. Numeric table columns (Unit Price, Quantity) are right-aligned; the SKU column uses a compact monospace treatment — both per the design system's table pattern.
- Two lessons from the Customers plan's final review are designed in from the start here, not left for a fix round: (1) the add/edit dialog's submit handler wraps its fetch/response handling in `try/catch/finally` so a network failure can never leave the Save button stuck disabled; (2) the client-side product list is both filtered *and sorted* by name in the same `useMemo`, and the deactivate/reactivate row action surfaces its error inline (`role="alert"`, red text, same treatment as the dialog) instead of failing silently.
- Testing: route-handler tests only (`vitest`, following `src/app/api/customers/route.test.ts`'s exact harness). No new UI test tooling; the frontend is verified by manual browser testing during implementation. The tenant-isolation test is mandatory for every route.
- Not in this plan: barcode/SKU/name autocomplete for the Sales Receipt line-item entry, the "quick-create modal from the receipt screen," and any Inventory-module behavior (stock movements, low-stock alerts) — all out of scope per the design spec and the MVP spec's requirements review.

---

## File Structure

```
src/
  app/
    api/
      products/
        route.ts                    (create: GET list, POST create)
        route.test.ts                 (create)
        check-uniqueness.ts            (create: shared SKU/barcode conflict helper)
        [id]/
          route.ts                     (create: PATCH update/deactivate/reactivate)
          route.test.ts                 (create)
    (app)/
      products/
        page.tsx                      (create: Server Component, initial fetch + Decimal serialization)
  components/
    products/
      products-client.tsx            (create: list, search, toggle, table)
      product-form-dialog.tsx        (create: add/edit modal)
    shell/
      nav-items.ts                    (modify: Products href null -> /products)
```

---

### Task 1: Product list and create API

**Files:**
- Create: `src/app/api/products/check-uniqueness.ts`
- Create: `src/app/api/products/route.ts`
- Create: `src/app/api/products/route.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth/config`, `withTenant` and `TenantClient` from `@/lib/db/tenant-context`.
- Produces: `findUniquenessConflict(tx, fields, excludeId?)` from `@/app/api/products/check-uniqueness` (used by Task 2's `[id]/route.ts` too — that task imports it as `../check-uniqueness`). `GET /api/products` (returns `Product[]`, sorted by `nameEn`), `POST /api/products` (creates and returns a `Product`, 201). Both used by Task 3's page/dialog via `fetch`.

- [ ] **Step 1: Create the shared uniqueness-check helper**

Create `src/app/api/products/check-uniqueness.ts`:

```typescript
import type { TenantClient } from "@/lib/db/tenant-context";

export async function findUniquenessConflict(
  tx: TenantClient,
  fields: { sku?: string | null; barcode?: string | null },
  excludeId?: string
): Promise<"sku" | "barcode" | null> {
  if (fields.sku) {
    const existing = await tx.product.findFirst({
      where: { sku: fields.sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (existing) return "sku";
  }
  if (fields.barcode) {
    const existing = await tx.product.findFirst({
      where: { barcode: fields.barcode, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (existing) return "barcode";
  }
  return null;
}
```

`tx` is already tenant-scoped (called through `withTenant`), so these `findFirst` calls are automatically limited to the active tenant — no explicit `tenantId` needed in the `where` clause. The `excludeId` parameter lets Task 2's update route check "does any *other* product have this SKU/barcode" without the product's own unchanged value triggering a false conflict against itself.

- [ ] **Step 2: Create the route**

Create `src/app/api/products/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { Unit } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { findUniquenessConflict } from "./check-uniqueness";

const VALID_UNITS: Unit[] = ["PIECE", "KG", "BOX", "CARTON", "LITER"];

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;

  const products = await withTenant(tenantId, (tx) => tx.product.findMany({ orderBy: { nameEn: "asc" } }));
  return NextResponse.json(products);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const body = await request.json();

  const nameEn = typeof body.nameEn === "string" ? body.nameEn.trim() : "";
  if (!nameEn) {
    return NextResponse.json({ error: "English name is required" }, { status: 400 });
  }

  const unitPrice = Number(body.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return NextResponse.json({ error: "Unit price is required and must be zero or more" }, { status: 400 });
  }

  let quantity = 0;
  if (body.quantity !== undefined && body.quantity !== "") {
    quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return NextResponse.json({ error: "Quantity must be zero or more" }, { status: 400 });
    }
  }

  let vatRate: number | null = null;
  if (body.vatRate !== undefined && body.vatRate !== null && body.vatRate !== "") {
    vatRate = Number(body.vatRate);
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return NextResponse.json({ error: "VAT rate must be between 0 and 100" }, { status: 400 });
    }
  }

  const unit: Unit = VALID_UNITS.includes(body.unit) ? body.unit : "PIECE";
  const sku = body.sku || null;
  const barcode = body.barcode || null;

  const conflict = await withTenant(tenantId, (tx) => findUniquenessConflict(tx, { sku, barcode }));
  if (conflict) {
    return NextResponse.json(
      { error: `This ${conflict === "sku" ? "SKU" : "barcode"} is already in use by another product` },
      { status: 409 }
    );
  }

  try {
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: {
          nameEn,
          nameAr: body.nameAr || null,
          sku,
          barcode,
          unit,
          unitPrice,
          vatRate,
          quantity,
        } as Prisma.ProductUncheckedCreateInput,
      })
    );
    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    // Backstop for the rare race between the proactive check above and this write —
    // the check already names the specific field in the common case.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "This SKU or barcode is already in use by another product" },
        { status: 409 }
      );
    }
    throw err;
  }
}
```

The `as Prisma.ProductUncheckedCreateInput` cast documents the same known gap covered in the Customers plan: `withTenant()`'s Prisma extension injects `tenantId` into `create()` at runtime, but Prisma's generated type for `create()` still requires `tenantId` (or a `tenant` relation) in `data` at compile time — the cast bridges that without changing runtime behavior.

- [ ] **Step 3: Create the test file**

Create `src/app/api/products/route.test.ts`:

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

describe("/api/products", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Products Test Co", tradeNameEn: "Products Test Shop", vatNumber: "300000000000068" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Products Co", tradeNameEn: "Other Products Shop", vatNumber: "300000000000075" },
    });
    otherTenantId = otherTenant.id;
    await withTenant(otherTenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Other Tenant's Product", unitPrice: 5 } as Prisma.ProductUncheckedCreateInput,
      })
    );
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("POST creates a product with valid data", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "Rice 5kg", sku: "SKU-001", barcode: "1111111111", unitPrice: "24.50", quantity: "10" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.nameEn).toBe("Rice 5kg");
    expect(body.sku).toBe("SKU-001");
    expect(body.unit).toBe("PIECE");
  });

  it("GET returns only this tenant's products, never another tenant's", async () => {
    const response = await GET();
    const body = await response.json();
    const names = body.map((p: { nameEn: string }) => p.nameEn);
    expect(names).toContain("Rice 5kg");
    expect(names).not.toContain("Other Tenant's Product");
  });

  it("POST returns 400 for an empty name", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "   ", unitPrice: "10" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("POST returns 400 for a missing unit price", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "No Price" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("POST returns 400 for a negative unit price", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "Negative Price", unitPrice: "-5" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("POST returns 400 for a negative quantity", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "Negative Qty", unitPrice: "10", quantity: "-1" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("POST returns 400 for an out-of-range VAT rate", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "Bad Vat", unitPrice: "10", vatRate: "150" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("POST returns 409 for a SKU already used within the same tenant", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "Duplicate Sku", unitPrice: "10", sku: "SKU-001" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("SKU");
  });

  it("POST returns 409 for a barcode already used within the same tenant", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "Duplicate Barcode", unitPrice: "10", barcode: "1111111111" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("barcode");
  });

  it("POST allows the same SKU and barcode across two different tenants", async () => {
    mockSession = { user: { tenantId: otherTenantId } };
    try {
      const request = new Request("http://localhost/api/products", {
        method: "POST",
        body: JSON.stringify({ nameEn: "Cross Tenant Same Codes", unitPrice: "10", sku: "SKU-001", barcode: "1111111111" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("POST allows multiple products with no SKU and no barcode", async () => {
    const first = await POST(
      new Request("http://localhost/api/products", { method: "POST", body: JSON.stringify({ nameEn: "No Codes One", unitPrice: "1" }) })
    );
    const second = await POST(
      new Request("http://localhost/api/products", { method: "POST", body: JSON.stringify({ nameEn: "No Codes Two", unitPrice: "1" }) })
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
      const request = new Request("http://localhost/api/products", {
        method: "POST",
        body: JSON.stringify({ nameEn: "Should Not Be Created", unitPrice: "1" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- products/route.test.ts`
Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/products/check-uniqueness.ts src/app/api/products/route.ts src/app/api/products/route.test.ts
git commit -m "Add the product list and create API"
```

---

### Task 2: Product update API (edit, deactivate, reactivate)

**Files:**
- Create: `src/app/api/products/[id]/route.ts`
- Create: `src/app/api/products/[id]/route.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth/config`, `withTenant` from `@/lib/db/tenant-context`, `findUniquenessConflict` from `../check-uniqueness` (Task 1).
- Produces: `PATCH /api/products/[id]` (partial update; accepts any of `nameEn`, `nameAr`, `sku`, `barcode`, `unit`, `unitPrice`, `vatRate`, `quantity`, `isActive`; returns the updated `Product`). Used by Task 3's dialog (edit) and row actions (deactivate/reactivate).

- [ ] **Step 1: Create the route**

Create `src/app/api/products/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { Unit } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { findUniquenessConflict } from "../check-uniqueness";

const VALID_UNITS: Unit[] = ["PIECE", "KG", "BOX", "CARTON", "LITER"];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const { id } = await params;
  const body = await request.json();

  const existing = await withTenant(tenantId, (tx) => tx.product.findUnique({ where: { id } }));
  if (!existing) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (body.nameEn !== undefined) {
    const nameEn = typeof body.nameEn === "string" ? body.nameEn.trim() : "";
    if (!nameEn) {
      return NextResponse.json({ error: "English name is required" }, { status: 400 });
    }
    data.nameEn = nameEn;
  }
  if (body.nameAr !== undefined) data.nameAr = body.nameAr || null;

  if (body.unitPrice !== undefined) {
    const unitPrice = Number(body.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: "Unit price is required and must be zero or more" }, { status: 400 });
    }
    data.unitPrice = unitPrice;
  }

  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return NextResponse.json({ error: "Quantity must be zero or more" }, { status: 400 });
    }
    data.quantity = quantity;
  }

  if (body.vatRate !== undefined) {
    if (body.vatRate === null || body.vatRate === "") {
      data.vatRate = null;
    } else {
      const vatRate = Number(body.vatRate);
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
        return NextResponse.json({ error: "VAT rate must be between 0 and 100" }, { status: 400 });
      }
      data.vatRate = vatRate;
    }
  }

  if (body.unit !== undefined) {
    data.unit = VALID_UNITS.includes(body.unit) ? body.unit : "PIECE";
  }
  if (body.sku !== undefined) data.sku = body.sku || null;
  if (body.barcode !== undefined) data.barcode = body.barcode || null;
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

  const conflict = await withTenant(tenantId, (tx) =>
    findUniquenessConflict(
      tx,
      { sku: data.sku as string | null | undefined, barcode: data.barcode as string | null | undefined },
      id
    )
  );
  if (conflict) {
    return NextResponse.json(
      { error: `This ${conflict === "sku" ? "SKU" : "barcode"} is already in use by another product` },
      { status: 409 }
    );
  }

  try {
    const product = await withTenant(tenantId, (tx) => tx.product.update({ where: { id }, data }));
    return NextResponse.json(product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "This SKU or barcode is already in use by another product" },
        { status: 409 }
      );
    }
    throw err;
  }
}
```

Note the `excludeId` (the product's own `id`) passed to `findUniquenessConflict` — without it, saving a product's *other* fields while its `sku`/`barcode` stay unchanged would falsely conflict against itself.

- [ ] **Step 2: Create the test file**

Create `src/app/api/products/[id]/route.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { PATCH } from "./route";

let tenantId: string;
let otherTenantId: string;
let productId: string;
let productWithSkuId: string;
let otherTenantProductId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/products/x", { method: "PATCH", body: JSON.stringify(body) });
}

describe("/api/products/[id]", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Product Patch Test Co", tradeNameEn: "Product Patch Shop", vatNumber: "300000000000082" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Editable Product", unitPrice: 10 } as Prisma.ProductUncheckedCreateInput })
    );
    productId = product.id;

    const productWithSku = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Product With Sku", unitPrice: 5, sku: "SKU-EXIST", barcode: "2222222222" } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productWithSkuId = productWithSku.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Product Patch Co", tradeNameEn: "Other Product Patch Shop", vatNumber: "300000000000099" },
    });
    otherTenantId = otherTenant.id;
    const otherProduct = await withTenant(otherTenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Other Tenant Product", unitPrice: 1 } as Prisma.ProductUncheckedCreateInput })
    );
    otherTenantProductId = otherProduct.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("updates a product's fields", async () => {
    const response = await PATCH(patchRequest({ nameEn: "Renamed Product", unitPrice: "12.5" }), {
      params: Promise.resolve({ id: productId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nameEn).toBe("Renamed Product");
    expect(body.unitPrice).toBe("12.5");
  });

  it("deactivates then reactivates a product", async () => {
    const deactivate = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: productId }) });
    expect(deactivate.status).toBe(200);
    expect((await deactivate.json()).isActive).toBe(false);

    const reactivate = await PATCH(patchRequest({ isActive: true }), { params: Promise.resolve({ id: productId }) });
    expect(reactivate.status).toBe(200);
    expect((await reactivate.json()).isActive).toBe(true);
  });

  it("returns 404 for a nonexistent id", async () => {
    const response = await PATCH(patchRequest({ nameEn: "Nope" }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for a product belonging to another tenant", async () => {
    const response = await PATCH(patchRequest({ nameEn: "Should not work" }), {
      params: Promise.resolve({ id: otherTenantProductId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 400 when clearing the name to empty", async () => {
    const response = await PATCH(patchRequest({ nameEn: "   " }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for a negative unit price", async () => {
    const response = await PATCH(patchRequest({ unitPrice: "-1" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for a negative quantity", async () => {
    const response = await PATCH(patchRequest({ quantity: "-1" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(400);
  });

  it("returns 400 for an out-of-range VAT rate", async () => {
    const response = await PATCH(patchRequest({ vatRate: "200" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(400);
  });

  it("returns 409 when updating sku to one already used in the same tenant", async () => {
    const response = await PATCH(patchRequest({ sku: "SKU-EXIST" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("SKU");
  });

  it("returns 409 when updating barcode to one already used in the same tenant", async () => {
    const response = await PATCH(patchRequest({ barcode: "2222222222" }), { params: Promise.resolve({ id: productId }) });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("barcode");
  });

  it("allows updating a product's own sku to its current value without a false conflict", async () => {
    const response = await PATCH(patchRequest({ sku: "SKU-EXIST" }), {
      params: Promise.resolve({ id: productWithSkuId }),
    });
    expect(response.status).toBe(200);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await PATCH(patchRequest({ nameEn: "Nope" }), { params: Promise.resolve({ id: productId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test -- products`
Expected: all tests in both `products/route.test.ts` and `products/[id]/route.test.ts` pass (14 + 13 = 27 total).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/products/\[id\]/route.ts src/app/api/products/\[id\]/route.test.ts
git commit -m "Add the product update API"
```

---

### Task 3: Products page — list, search, active/inactive toggle, add/edit dialog

**Files:**
- Create: `src/app/(app)/products/page.tsx`
- Create: `src/components/products/products-client.tsx`
- Create: `src/components/products/product-form-dialog.tsx`
- Modify: `src/components/shell/nav-items.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth/config`, `withTenant` from `@/lib/db/tenant-context` (in `page.tsx`); `GET/POST /api/products` and `PATCH /api/products/[id]` (Tasks 1 and 2, via `fetch`); `Button`/`Input`/`Label`/`Card`/`Checkbox`/`Badge`/`Dialog`-family/`Table`-family from `@/components/ui/*` (all already installed, no new shadcn CLI step needed this task).

- [ ] **Step 1: Enable the Products nav link**

In `src/components/shell/nav-items.ts`, change:

```typescript
{ label: "Products", href: null },
```

to:

```typescript
{ label: "Products", href: "/products" },
```

- [ ] **Step 2: Create the page (Server Component)**

Create `src/app/(app)/products/page.tsx`:

```tsx
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { ProductsClient } from "@/components/products/products-client";

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

- [ ] **Step 3: Create the client component**

Create `src/components/products/products-client.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Product } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ProductFormDialog } from "./product-form-dialog";

export type SerializedProduct = Omit<Product, "unitPrice" | "vatRate" | "quantity"> & {
  unitPrice: string;
  vatRate: string | null;
  quantity: string;
};

export function ProductsClient({ initialProducts }: { initialProducts: SerializedProduct[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{ open: boolean; product: SerializedProduct | null }>({
    open: false,
    product: null,
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products
      .filter((p) => {
        if (!showInactive && !p.isActive) return false;
        if (!query) return true;
        return (
          p.nameEn.toLowerCase().includes(query) ||
          (p.nameAr ?? "").toLowerCase().includes(query) ||
          (p.sku ?? "").toLowerCase().includes(query) ||
          (p.barcode ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  }, [products, search, showInactive]);

  function handleSaved(product: SerializedProduct) {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      return exists ? prev.map((p) => (p.id === product.id ? product : p)) : [...prev, product];
    });
    setDialogState({ open: false, product: null });
  }

  async function toggleActive(product: SerializedProduct) {
    setActionError(null);
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !product.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? "Something went wrong");
        return;
      }
      const updated = await response.json();
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      setActionError("Something went wrong");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search by name, SKU, or barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
          <label className="flex items-center gap-2 text-sm text-body">
            <Checkbox checked={showInactive} onCheckedChange={(checked) => setShowInactive(checked === true)} />
            Show inactive
          </label>
        </div>
        <Button variant="primary" onClick={() => setDialogState({ open: true, product: null })}>
          + Add Product
        </Button>
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-red-600">
          {actionError}
        </p>
      )}

      <Card className="border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-fg">No products yet — add your first one</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead>VAT</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => (
                <TableRow key={product.id} className={!product.isActive ? "opacity-50" : undefined}>
                  <TableCell className="font-mono text-xs">{product.sku ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{product.barcode ?? "—"}</TableCell>
                  <TableCell className="font-medium text-heading">
                    {product.nameEn}
                    {product.nameAr && <div className="text-xs text-muted-fg">{product.nameAr}</div>}
                  </TableCell>
                  <TableCell>{product.unit}</TableCell>
                  <TableCell className="text-right">{product.unitPrice}</TableCell>
                  <TableCell>
                    {product.vatRate === null ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : (
                      <Badge>{product.vatRate}%</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{product.quantity}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDialogState({ open: true, product })}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleActive(product)}>
                        {product.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ProductFormDialog
        open={dialogState.open}
        product={dialogState.product}
        onOpenChange={(open) => setDialogState((s) => ({ ...s, open }))}
        onSaved={handleSaved}
      />
    </div>
  );
}
```

- [ ] **Step 4: Create the dialog component**

Create `src/components/products/product-form-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { SerializedProduct } from "./products-client";

interface ProductFormDialogProps {
  open: boolean;
  product: SerializedProduct | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (product: SerializedProduct) => void;
}

const UNIT_OPTIONS = [
  { value: "PIECE", label: "Piece" },
  { value: "KG", label: "KG" },
  { value: "BOX", label: "Box" },
  { value: "CARTON", label: "Carton" },
  { value: "LITER", label: "Liter" },
];

const EMPTY_FORM = {
  nameEn: "",
  nameAr: "",
  sku: "",
  barcode: "",
  unit: "PIECE",
  unitPrice: "",
  useDefaultVat: true,
  vatRate: "",
  quantity: "0",
};

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function ProductFormDialog({ open, product, onOpenChange, onSaved }: ProductFormDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        product
          ? {
              nameEn: product.nameEn,
              nameAr: product.nameAr ?? "",
              sku: product.sku ?? "",
              barcode: product.barcode ?? "",
              unit: product.unit,
              unitPrice: product.unitPrice,
              useDefaultVat: product.vatRate === null,
              vatRate: product.vatRate ?? "",
              quantity: product.quantity,
            }
          : EMPTY_FORM
      );
      setError(null);
      setSaving(false);
    }
  }, [open, product]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = product ? `/api/products/${product.id}` : "/api/products";
    const method = product ? "PATCH" : "POST";
    const payload = {
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      sku: form.sku,
      barcode: form.barcode,
      unit: form.unit,
      unitPrice: form.unitPrice,
      vatRate: form.useDefaultVat ? null : form.vatRate,
      quantity: form.quantity,
    };

    try {
      const response = await fetch(url, { method, body: JSON.stringify(payload) });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Something went wrong");
        return;
      }
      onSaved(body);
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? "Edit Product" : "Add Product"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-name-en" className={LABEL_CLASS}>
                Name (English)
              </Label>
              <Input
                id="product-name-en"
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="product-name-ar" className={LABEL_CLASS}>
                Name (Arabic)
              </Label>
              <Input
                id="product-name-ar"
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-sku" className={LABEL_CLASS}>
                SKU
              </Label>
              <Input id="product-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="product-barcode" className={LABEL_CLASS}>
                Barcode
              </Label>
              <Input
                id="product-barcode"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-unit" className={LABEL_CLASS}>
                Unit
              </Label>
              <select
                id="product-unit"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {UNIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="product-price" className={LABEL_CLASS}>
                Unit Price
              </Label>
              <Input
                id="product-price"
                type="number"
                step="0.01"
                min="0"
                value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-2 text-xs text-body">
              <Checkbox
                checked={form.useDefaultVat}
                onCheckedChange={(checked) => setForm({ ...form, useDefaultVat: checked === true })}
              />
              Use default VAT rate
            </label>
            {!form.useDefaultVat && (
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="VAT rate (%)"
                value={form.vatRate}
                onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
              />
            )}
          </div>

          <div>
            <Label htmlFor="product-quantity" className={LABEL_CLASS}>
              Quantity
            </Label>
            <Input
              id="product-quantity"
              type="number"
              step="0.001"
              min="0"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
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

- [ ] **Step 5: Verify it builds**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run dev`, log in (`owner@demo.local` / `changeme123`), navigate to `/products` (now enabled in the sidebar).

Expected:
- Empty state shows "No products yet — add your first one" with no button in that block (the toolbar's "+ Add Product" is the only one, matching the Customers fix).
- Creating a product with just a name and price succeeds and appears in the table, correctly sorted alphabetically alongside any others (create a second product whose name sorts before the first and confirm it lands in the right position without a page reload).
- Creating a product with a SKU or barcode that duplicates an existing one shows the specific inline error ("This SKU is already in use..." vs "...barcode...") and does not close the dialog.
- The VAT toggle: default (checked) shows a "Default" badge in the table; unchecking it and entering e.g. `0` shows a "0%" badge, confirming exempt-at-zero is distinguishable from "use tenant default."
- Editing a product via its row's "Edit" button pre-fills the dialog (including the VAT toggle's correct checked/unchecked state) and saves changes.
- "Deactivate" grays out a row and removes it from the default view; "Show inactive" reveals it with a "Reactivate" button; triggering a failure path (e.g. deactivate twice quickly, or inspect network) confirms an inline error would surface rather than failing silently.
- The search box filters by name/SKU/barcode with no network request per keystroke.
- No console error about Decimal/class-instance serialization when the page first loads (confirms the Server Component's `.toString()` conversion is working).

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/products/page.tsx src/components/products src/components/shell/nav-items.ts
git commit -m "Add the products list page with search, filtering, and the add/edit dialog"
```
