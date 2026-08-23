import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET, POST } from "./route";

let tenantId: string;
let userId: string;
let productAId: string;
let productBId: string;
let supplierId: string;
let mockSession: { user: { tenantId: string; role: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/purchase-receipts", { method: "POST", body: JSON.stringify(body) });
}

function getRequest(query = "") {
  return new Request(`http://localhost/api/purchase-receipts${query}`);
}

describe("/api/purchase-receipts", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const tenant = await prisma.tenant.create({
      data: {
        legalName: "Purchase Receipt Test Co",
        tradeNameEn: "Purchase Receipt Test Shop",
        vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
      },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `purchase-route-test+${uniqueId}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, role: "OWNER", id: userId } };

    const productA = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Purchase Test Product A", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productAId = productA.id;
    const productB = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Purchase Test Product B", unitPrice: 20, quantity: 0 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productBId = productB.id;

    const supplier = await withTenant(tenantId, (tx) =>
      tx.supplier.create({
        data: { name: "Purchase Test Supplier", vatId: "300000000000003" } as Prisma.SupplierUncheckedCreateInput,
      })
    );
    supplierId = supplier.id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.purchaseReceiptLine.deleteMany({ where: { tenantId } });
    await prisma.purchaseReceipt.deleteMany({ where: { tenantId } });
    await prisma.supplier.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it(
    "POST creates a purchase receipt with two lines, restocks both products, and returns unit/subtotal per line",
    { timeout: 20000 },
    async () => {
      const response = await POST(
        postRequest({
          supplierId,
          supplierReceiptNumber: "INV-9001",
          purchaseDate: "2026-01-15",
          paymentMethod: "CREDIT",
          lines: [
            { productId: productAId, unit: "PIECE", quantity: 10, unitPrice: 8, vatRate: 15 },
            { productId: productBId, unit: "BOX", quantity: 4, unitPrice: 25, vatRate: 15 },
          ],
        })
      );
      expect(response.status).toBe(201);
      const body = await response.json();

      expect(body.purchaseReceipt.supplierReceiptNumber).toBe("INV-9001");
      expect(body.purchaseReceipt.paymentMethod).toBe("CREDIT");
      expect(body.purchaseReceipt.lines).toHaveLength(2);

      const lineA = body.purchaseReceipt.lines.find((l: { productId: string }) => l.productId === productAId);
      expect(lineA.unit).toBe("PIECE");
      expect(Number(lineA.lineSubtotal)).toBe(80);
      expect(Number(lineA.lineVat)).toBe(12);
      expect(Number(lineA.lineTotal)).toBe(92);

      const lineB = body.purchaseReceipt.lines.find((l: { productId: string }) => l.productId === productBId);
      expect(lineB.unit).toBe("BOX");
      expect(Number(lineB.lineSubtotal)).toBe(100);

      expect(Number(body.purchaseReceipt.subtotal)).toBe(180);
      expect(Number(body.purchaseReceipt.vatTotal)).toBe(27);
      expect(Number(body.purchaseReceipt.grandTotal)).toBe(207);

      expect(body.movements).toHaveLength(2);
      expect(body.movements.every((m: { purchaseReceipt: { number: number } }) => m.purchaseReceipt.number === body.purchaseReceipt.number)).toBe(true);

      const productA = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productAId } }));
      expect(Number(productA.quantity)).toBe(15);
      const productB = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productBId } }));
      expect(Number(productB.quantity)).toBe(4);
    }
  );

  it("POST assigns sequential purchase receipt numbers per tenant", { timeout: 20000 }, async () => {
    const first = await POST(
      postRequest({
        supplierId,
        purchaseDate: "2026-01-16",
        paymentMethod: "CASH",
        lines: [{ productId: productAId, unit: "PIECE", quantity: 1, unitPrice: 1, vatRate: 0 }],
      })
    );
    const second = await POST(
      postRequest({
        supplierId,
        purchaseDate: "2026-01-17",
        paymentMethod: "CASH",
        lines: [{ productId: productAId, unit: "PIECE", quantity: 1, unitPrice: 1, vatRate: 0 }],
      })
    );
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.purchaseReceipt.number).toBe(firstBody.purchaseReceipt.number + 1);
  });

  it("POST rejects when supplierId is missing", async () => {
    const response = await POST(
      postRequest({
        purchaseDate: "2026-01-15",
        paymentMethod: "CASH",
        lines: [{ productId: productAId, unit: "PIECE", quantity: 1, unitPrice: 1, vatRate: 0 }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("POST rejects when there are no lines", async () => {
    const response = await POST(
      postRequest({ supplierId, purchaseDate: "2026-01-15", paymentMethod: "CASH", lines: [] })
    );
    expect(response.status).toBe(400);
  });

  it("POST rejects a non-positive quantity", async () => {
    const response = await POST(
      postRequest({
        supplierId,
        purchaseDate: "2026-01-15",
        paymentMethod: "CASH",
        lines: [{ productId: productAId, unit: "PIECE", quantity: 0, unitPrice: 1, vatRate: 0 }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("POST rejects an invalid unit", async () => {
    const response = await POST(
      postRequest({
        supplierId,
        purchaseDate: "2026-01-15",
        paymentMethod: "CASH",
        lines: [{ productId: productAId, unit: "PALLET", quantity: 1, unitPrice: 1, vatRate: 0 }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("POST rejects an unknown paymentMethod", async () => {
    const response = await POST(
      postRequest({
        supplierId,
        purchaseDate: "2026-01-15",
        paymentMethod: "BANK_TRANSFER",
        lines: [{ productId: productAId, unit: "PIECE", quantity: 1, unitPrice: 1, vatRate: 0 }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("POST returns 404 for an unknown supplierId", async () => {
    const response = await POST(
      postRequest({
        supplierId: "00000000-0000-0000-0000-000000000000",
        purchaseDate: "2026-01-15",
        paymentMethod: "CASH",
        lines: [{ productId: productAId, unit: "PIECE", quantity: 1, unitPrice: 1, vatRate: 0 }],
      })
    );
    expect(response.status).toBe(404);
  });

  it("POST returns 400 for an unknown productId", async () => {
    const response = await POST(
      postRequest({
        supplierId,
        purchaseDate: "2026-01-15",
        paymentMethod: "CASH",
        lines: [{ productId: "00000000-0000-0000-0000-000000000000", unit: "PIECE", quantity: 1, unitPrice: 1, vatRate: 0 }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("POST returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await POST(
        postRequest({
          supplierId,
          purchaseDate: "2026-01-15",
          paymentMethod: "CASH",
          lines: [{ productId: productAId, unit: "PIECE", quantity: 1, unitPrice: 1, vatRate: 0 }],
        })
      );
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER", id: userId } };
    }
  });

  it("POST returns 403 for a Cashier when the Owner has turned off cashierCanManageCatalog", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER", id: userId } };
    try {
      const response = await POST(
        postRequest({
          supplierId,
          purchaseDate: "2026-01-15",
          paymentMethod: "CASH",
          lines: [{ productId: productAId, unit: "PIECE", quantity: 1, unitPrice: 1, vatRate: 0 }],
        })
      );
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER", id: userId } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });

  it("GET lists purchase receipts newest purchase-date first, searchable by supplier name and supplier receipt #", { timeout: 20000 }, async () => {
    const all = await GET(getRequest());
    const allBody = await all.json();
    expect(allBody.total).toBeGreaterThanOrEqual(3);
    expect(new Date(allBody.receipts[0].purchaseDate).getTime()).toBeGreaterThanOrEqual(
      new Date(allBody.receipts[allBody.receipts.length - 1].purchaseDate).getTime()
    );

    const bySupplierName = await GET(getRequest(`?search=${encodeURIComponent("Purchase Test Supplier")}`));
    const bySupplierBody = await bySupplierName.json();
    expect(bySupplierBody.total).toBeGreaterThanOrEqual(3);

    const bySupplierReceiptNumber = await GET(getRequest(`?search=INV-9001`));
    const bySupplierReceiptBody = await bySupplierReceiptNumber.json();
    expect(bySupplierReceiptBody.total).toBe(1);
    expect(bySupplierReceiptBody.receipts[0].supplierReceiptNumber).toBe("INV-9001");
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
});
