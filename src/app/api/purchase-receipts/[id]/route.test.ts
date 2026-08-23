import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST } from "../route";
import { GET } from "./route";

let tenantId: string;
let userId: string;
let productId: string;
let supplierId: string;
let purchaseReceiptId: string;
let mockSession: { user: { tenantId: string; role: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function getDetailRequest(id: string) {
  return { request: new Request(`http://localhost/api/purchase-receipts/${id}`), params: Promise.resolve({ id }) };
}

describe("/api/purchase-receipts/[id]", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    // The default vitest hook timeout (10s) is shorter than the POST route's
    // own transaction timeout (20s) -- this beforeAll invokes POST directly,
    // so it needs the longer timeout passed below, or a slow test run can
    // have vitest move on to afterAll cleanup while the transaction is still
    // in flight (which then hits an FK constraint on the still-open row).
    const tenant = await prisma.tenant.create({
      data: {
        legalName: "Purchase Detail Test Co",
        tradeNameEn: "Purchase Detail Test Shop",
        vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
      },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `purchase-detail-test+${uniqueId}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, role: "OWNER", id: userId } };

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Purchase Detail Test Product", unitPrice: 10, quantity: 0 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productId = product.id;

    const supplier = await withTenant(tenantId, (tx) =>
      tx.supplier.create({
        data: {
          name: "Purchase Detail Test Supplier",
          vatId: "300000000000003",
          crNumber: "1010101010",
          phone: "0500000000",
        } as Prisma.SupplierUncheckedCreateInput,
      })
    );
    supplierId = supplier.id;

    const created = await POST(
      new Request("http://localhost/api/purchase-receipts", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          supplierReceiptNumber: "SUP-77",
          purchaseDate: "2026-02-01",
          paymentMethod: "CREDIT",
          lines: [{ productId, unit: "DOZEN", quantity: 3, unitPrice: 12, vatAmount: 5.4 }],
        }),
      })
    );
    const createdBody = await created.json();
    purchaseReceiptId = createdBody.purchaseReceipt.id;
  }, 20000);

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

  it("GET returns supplier VAT ID/CR/phone and lines with unit + subtotal", async () => {
    const { request, params } = getDetailRequest(purchaseReceiptId);
    const response = await GET(request, { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.supplierReceiptNumber).toBe("SUP-77");
    expect(body.supplier.name).toBe("Purchase Detail Test Supplier");
    expect(body.supplier.vatId).toBe("300000000000003");
    expect(body.supplier.crNumber).toBe("1010101010");
    expect(body.supplier.phone).toBe("0500000000");
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].unit).toBe("DOZEN");
    expect(Number(body.lines[0].lineSubtotal)).toBe(36);
    expect(Number(body.lines[0].lineVat)).toBe(5.4);
    expect(Number(body.lines[0].lineTotal)).toBe(41.4);
  });

  it("GET returns 404 for an unknown id", async () => {
    const { request, params } = getDetailRequest("00000000-0000-0000-0000-000000000000");
    const response = await GET(request, { params });
    expect(response.status).toBe(404);
  });

  it("GET returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const { request, params } = getDetailRequest(purchaseReceiptId);
      const response = await GET(request, { params });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER", id: userId } };
    }
  });
});
