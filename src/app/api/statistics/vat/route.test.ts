import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET } from "./route";

let tenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function getRequest(query = "") {
  return new Request(`http://localhost/api/statistics/vat${query}`);
}

describe("/api/statistics/vat", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const tenant = await prisma.tenant.create({
      data: {
        legalName: "Statistics Test Co",
        tradeNameEn: "Statistics Test Shop",
        vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
      },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };

    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const supplier = await withTenant(tenantId, (tx) =>
      tx.supplier.create({ data: { name: "Statistics Test Supplier" } as Prisma.SupplierUncheckedCreateInput })
    );

    // Q1 2026 sale: 100 subtotal, 15 VAT -> outgoing VAT 15
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          type: "SALES_RECEIPT",
          number: 1,
          customerId: customer.id,
          subtotal: 100,
          vatTotal: 15,
          grandTotal: 115,
          createdAt: new Date("2026-02-10T12:00:00Z"),
        } as Prisma.DocumentUncheckedCreateInput,
      })
    );
    // Q1 2026 purchase: 200 subtotal, 30 VAT -> incoming VAT 30
    await withTenant(tenantId, (tx) =>
      tx.purchaseReceipt.create({
        data: {
          number: 1,
          supplierId: supplier.id,
          purchaseDate: new Date("2026-02-15T00:00:00Z"),
          paymentMethod: "CASH",
          subtotal: 200,
          vatTotal: 30,
          grandTotal: 230,
        } as Prisma.PurchaseReceiptUncheckedCreateInput,
      })
    );
    // Q2 2026 sale, should not be counted in the Q1 query
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          type: "SALES_RECEIPT",
          number: 2,
          customerId: customer.id,
          subtotal: 1000,
          vatTotal: 150,
          grandTotal: 1150,
          createdAt: new Date("2026-05-10T12:00:00Z"),
        } as Prisma.DocumentUncheckedCreateInput,
      })
    );
  });

  afterAll(async () => {
    await prisma.purchaseReceipt.deleteMany({ where: { tenantId } });
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.supplier.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("computes outgoing/incoming VAT and net payable for the requested quarter only", async () => {
    const response = await GET(getRequest("?year=2026&quarter=1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.year).toBe(2026);
    expect(body.quarter).toBe(1);
    expect(Number(body.outgoingVat)).toBe(15);
    expect(Number(body.incomingVat)).toBe(30);
    expect(Number(body.netPayable)).toBe(-15);
  });

  it("returns zeros for a quarter with no activity", async () => {
    const response = await GET(getRequest("?year=2019&quarter=3"));
    const body = await response.json();
    expect(Number(body.outgoingVat)).toBe(0);
    expect(Number(body.incomingVat)).toBe(0);
    expect(Number(body.netPayable)).toBe(0);
  });

  it("defaults to the current quarter when no year/quarter is given", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.year).toBeGreaterThan(2000);
    expect([1, 2, 3, 4]).toContain(body.quarter);
  });

  it("returns 403 for a Cashier (owner-only)", async () => {
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await GET(getRequest("?year=2026&quarter=1"));
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET(getRequest());
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
