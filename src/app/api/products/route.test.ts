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
