import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { GET } from "./route";

let tenantId: string;
let otherTenantId: string;
let receiptId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("GET /api/receipts/[id]/pdf", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "PDF Test Co", tradeNameEn: "PDF Test Shop", tradeNameAr: "متجر بي دي إف", vatNumber: "300000000000488" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });
    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "PDF Product", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput })
    );

    const saveResponse = await createReceipt(
      new Request("http://localhost/api/receipts", {
        method: "POST",
        body: JSON.stringify({ customer: { name: "", vatId: "" }, lines: [{ productId: product.id, quantity: "1" }] }),
      })
    );
    const saved = await saveResponse.json();
    receiptId = saved.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "PDF Other Co", tradeNameEn: "PDF Other Shop", vatNumber: "300000000000495" },
    });
    otherTenantId = otherTenant.id;
  }, 30000);

  afterAll(async () => {
    await prisma.documentLine.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  }, 30000);

  function pdfRequest() {
    return new Request(`http://localhost/api/receipts/${receiptId}/pdf`);
  }

  it("returns a non-empty PDF for a valid receipt", { timeout: 30000 }, async () => {
    const response = await GET(pdfRequest(), { params: Promise.resolve({ id: receiptId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
    // %PDF is the standard magic-bytes signature every valid PDF file starts with
    const magic = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 4));
    expect(magic).toBe("%PDF");
  });

  it("returns 404 for a receipt belonging to another tenant", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: otherTenantId } };
    try {
      const response = await GET(pdfRequest(), { params: Promise.resolve({ id: receiptId }) });
      expect(response.status).toBe(404);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("returns 404 for a nonexistent id", { timeout: 30000 }, async () => {
    const response = await GET(
      new Request("http://localhost/api/receipts/00000000-0000-0000-0000-000000000000/pdf"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await GET(pdfRequest(), { params: Promise.resolve({ id: receiptId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
