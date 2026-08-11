import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST as createQuotation } from "@/app/api/quotations/route";
import { GET } from "./route";

let tenantId: string;
let otherTenantId: string;
let quotationId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("GET /api/quotations/[id]/pdf", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Quotation PDF Co", tradeNameEn: "Quotation PDF Shop", tradeNameAr: "متجر عرض سعر", vatNumber: "300000000001004" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });
    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Quotation PDF Product", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput })
    );

    const saveResponse = await createQuotation(
      new Request("http://localhost/api/quotations", {
        method: "POST",
        body: JSON.stringify({ customer: { name: "", vatId: "" }, lines: [{ productId: product.id, quantity: "1" }] }),
      })
    );
    const saved = await saveResponse.json();
    quotationId = saved.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Quotation PDF Other Co", tradeNameEn: "Quotation PDF Other Shop", vatNumber: "300000000001011" },
    });
    otherTenantId = otherTenant.id;
    // The route now looks up Settings for the requesting tenant (to pick the print
    // format), so every tenant it queries against needs a Settings row -- same as in
    // production, where onboarding always creates one alongside the tenant.
    await prisma.settings.create({ data: { tenantId: otherTenantId, defaultVatRate: 15 } });
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
    return new Request(`http://localhost/api/quotations/${quotationId}/pdf`);
  }

  it("returns a non-empty PDF for a valid quotation", { timeout: 30000 }, async () => {
    const response = await GET(pdfRequest(), { params: Promise.resolve({ id: quotationId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("Content-Disposition")).toContain(`quotation-`);
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
    const magic = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 4));
    expect(magic).toBe("%PDF");
  });

  it("returns 404 for a quotation belonging to another tenant", { timeout: 30000 }, async () => {
    mockSession = { user: { tenantId: otherTenantId } };
    try {
      const response = await GET(pdfRequest(), { params: Promise.resolve({ id: quotationId }) });
      expect(response.status).toBe(404);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("returns 404 for a nonexistent id", { timeout: 30000 }, async () => {
    const response = await GET(
      new Request("http://localhost/api/quotations/00000000-0000-0000-0000-000000000000/pdf"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(response.status).toBe(404);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await GET(pdfRequest(), { params: Promise.resolve({ id: quotationId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("returns a non-empty A4 PDF when the tenant's printFormat is A4", { timeout: 30000 }, async () => {
    await prisma.settings.update({ where: { tenantId }, data: { printFormat: "A4" } });
    try {
      const response = await GET(pdfRequest(), { params: Promise.resolve({ id: quotationId }) });
      expect(response.status).toBe(200);
      const buffer = await response.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
      const magic = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 4));
      expect(magic).toBe("%PDF");
    } finally {
      await prisma.settings.update({ where: { tenantId }, data: { printFormat: "THERMAL" } });
    }
  });

  it("still returns the thermal PDF when printFormat is THERMAL (regression guard)", { timeout: 30000 }, async () => {
    const response = await GET(pdfRequest(), { params: Promise.resolve({ id: quotationId }) });
    expect(response.status).toBe(200);
    const buffer = await response.arrayBuffer();
    const magic = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 4));
    expect(magic).toBe("%PDF");
  });
});
