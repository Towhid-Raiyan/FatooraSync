import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET, POST } from "./route";

let tenantId: string;
let userId: string;
let productId: string;
let supplierId: string;
let mockSession: { user: { tenantId: string; role: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/inventory/movements", { method: "POST", body: JSON.stringify(body) });
}

function getRequest(query = "") {
  return new Request(`http://localhost/api/inventory/movements${query}`);
}

describe("/api/inventory/movements", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const tenant = await prisma.tenant.create({
      data: { legalName: "Inventory Route Test Co", tradeNameEn: "Inventory Route Test Shop", vatNumber: `30000000000${uniqueId.toString().slice(-4)}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `inventory-route-test+${uniqueId}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, role: "OWNER", id: userId } };

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Ledger Test Product", unitPrice: 10, quantity: 50 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productId = product.id;

    const supplier = await withTenant(tenantId, (tx) =>
      tx.supplier.create({ data: { name: "Route Test Supplier" } as Prisma.SupplierUncheckedCreateInput })
    );
    supplierId = supplier.id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.supplier.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it(
    "POST records a RESTOCK, increments the product's quantity, and stores cost/supplier/note",
    { timeout: 20000 },
    async () => {
    const response = await POST(
      postRequest({ productId, type: "RESTOCK", quantity: 20, unitCost: 5.5, supplierId, note: "invoice #1" })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.type).toBe("RESTOCK");
    expect(Number(body.quantityDelta)).toBe(20);
    expect(Number(body.quantityAfter)).toBe(70);
    expect(Number(body.unitCost)).toBe(5.5);
    expect(body.supplierId).toBe(supplierId);
    expect(body.note).toBe("invoice #1");

    const product = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(Number(product.quantity)).toBe(70);
    }
  );

  it(
    "POST records an ADJUSTMENT with a reason and can move stock in either direction",
    { timeout: 20000 },
    async () => {
      const down = await POST(
        postRequest({ productId, type: "ADJUSTMENT", quantity: -5, reason: "DAMAGE", note: "crate damaged" })
      );
      expect(down.status).toBe(201);
      const downBody = await down.json();
      expect(downBody.reason).toBe("DAMAGE");
      expect(Number(downBody.quantityAfter)).toBe(65);

      const up = await POST(postRequest({ productId, type: "ADJUSTMENT", quantity: 3, reason: "RECOUNT" }));
      expect(up.status).toBe(201);
      const upBody = await up.json();
      expect(Number(upBody.quantityAfter)).toBe(68);
    }
  );

  it("POST rejects an ADJUSTMENT reasoned OTHER with no note", async () => {
    const response = await POST(postRequest({ productId, type: "ADJUSTMENT", quantity: -1, reason: "OTHER" }));
    expect(response.status).toBe(400);
  });

  it("POST accepts an ADJUSTMENT reasoned OTHER when a note is provided", async () => {
    const response = await POST(
      postRequest({ productId, type: "ADJUSTMENT", quantity: -1, reason: "OTHER", note: "explained here" })
    );
    expect(response.status).toBe(201);
  });

  it("POST rejects an unknown adjustment reason", async () => {
    const response = await POST(postRequest({ productId, type: "ADJUSTMENT", quantity: -1, reason: "MADE_UP" }));
    expect(response.status).toBe(400);
  });

  it("POST rejects a RESTOCK with a non-positive quantity", async () => {
    const response = await POST(postRequest({ productId, type: "RESTOCK", quantity: 0 }));
    expect(response.status).toBe(400);
  });

  it("POST rejects an unknown type", async () => {
    const response = await POST(postRequest({ productId, type: "SALE", quantity: 1 }));
    expect(response.status).toBe(400);
  });

  it("POST returns 404 for an unknown productId", async () => {
    const response = await POST(
      postRequest({ productId: "00000000-0000-0000-0000-000000000000", type: "RESTOCK", quantity: 1 })
    );
    expect(response.status).toBe(404);
  });

  it("POST returns 404 for an unknown supplierId", async () => {
    const response = await POST(
      postRequest({ productId, type: "RESTOCK", quantity: 1, supplierId: "00000000-0000-0000-0000-000000000000" })
    );
    expect(response.status).toBe(404);
  });

  it("GET returns movements newest-first, filterable by product and type", { timeout: 20000 }, async () => {
    const all = await GET(getRequest());
    const allBody = await all.json();
    expect(allBody.length).toBeGreaterThanOrEqual(4); // the 4 successful POSTs above (RESTOCK, DAMAGE, RECOUNT, OTHER-with-note)
    expect(new Date(allBody[0].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(allBody[1].createdAt).getTime());

    const restocksOnly = await GET(getRequest(`?type=RESTOCK`));
    const restocksBody = await restocksOnly.json();
    expect(restocksBody.every((m: { type: string }) => m.type === "RESTOCK")).toBe(true);

    const byProduct = await GET(getRequest(`?productId=${productId}`));
    const byProductBody = await byProduct.json();
    expect(byProductBody.every((m: { productId: string }) => m.productId === productId)).toBe(true);
  });

  it("POST returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await POST(postRequest({ productId, type: "RESTOCK", quantity: 1 }));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER", id: userId } };
    }
  });

  it("GET returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET(getRequest());
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER", id: userId } };
    }
  });

  it("POST returns 403 for a Cashier when the Owner has turned off cashierCanManageCatalog", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER", id: userId } };
    try {
      const response = await POST(postRequest({ productId, type: "RESTOCK", quantity: 1 }));
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER", id: userId } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });

  it("GET still works for a Cashier even when cashierCanManageCatalog is off (view-only isn't gated)", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER", id: userId } };
    try {
      const response = await GET(getRequest());
      expect(response.status).toBe(200);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER", id: userId } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });
});
