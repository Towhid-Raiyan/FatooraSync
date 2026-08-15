import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET } from "./route";

let tenantId: string;
let receiptId: string;
let otherTenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("/api/receipts/[id]/print-data", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Print Route Test Co", tradeNameEn: "Print Route Shop", vatNumber: "300000000000171" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const customer = await withTenant(tenantId, (tx) => tx.customer.create({ data: { tenantId, name: "Print Route Customer" } }));
    const receipt = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: { tenantId, type: "SALES_RECEIPT", number: 1, customerId: customer.id, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5, qrCode: "x" },
      })
    );
    receiptId = receipt.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Print Route Co", tradeNameEn: "Other Print Route Shop", vatNumber: "300000000000188" },
    });
    otherTenantId = otherTenant.id;
    // getReceiptPrintData looks up Settings for the requesting tenant (to pick
    // the print format), so every tenant it queries against needs a Settings
    // row -- same as in production, where onboarding always creates one
    // alongside the tenant.
    await withTenant(otherTenantId, (tx) => tx.settings.create({ data: { tenantId: otherTenantId } }));
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("returns the receipt's print data", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: receiptId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.document.id).toBe(receiptId);
    expect(body.printFormat).toBe("THERMAL");
  });

  it("returns 404 for a document belonging to another tenant", async () => {
    mockSession = { user: { tenantId: otherTenantId, role: "OWNER" } };
    try {
      const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: receiptId }) });
      expect(response.status).toBe(404);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: receiptId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
