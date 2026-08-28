import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET, POST } from "./route";

let tenantId: string;
let otherTenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("/api/products", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Products Test Co", tradeNameEn: "Products Test Shop", vatNumber: "300000000000068" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };

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

  it("POST creates a product with a system-generated SKU, ignoring any sku sent in the body", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "Rice 5kg", sku: "CLIENT-SUPPLIED", barcode: "1111111111", unitPrice: "24.50", quantity: "10" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.nameEn).toBe("Rice 5kg");
    expect(body.sku).toMatch(/^SKU-\d{6}$/);
    expect(body.sku).not.toBe("CLIENT-SUPPLIED");
    expect(body.unit).toBe("PIECE");
  });

  it("POST assigns sequential SKUs, one after another, within a tenant", async () => {
    const first = await POST(
      new Request("http://localhost/api/products", { method: "POST", body: JSON.stringify({ nameEn: "Sequence One", unitPrice: "1" }) })
    );
    const second = await POST(
      new Request("http://localhost/api/products", { method: "POST", body: JSON.stringify({ nameEn: "Sequence Two", unitPrice: "1" }) })
    );
    const firstBody = await first.json();
    const secondBody = await second.json();
    const firstNumber = Number(firstBody.sku.split("-")[1]);
    const secondNumber = Number(secondBody.sku.split("-")[1]);
    expect(secondNumber).toBe(firstNumber + 1);
  });

  it("POST creates a product with a client-supplied id, for offline quick-create sync", async () => {
    const clientId = "11111111-1111-1111-1111-111111111111";
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ id: clientId, nameEn: "Offline Product", unitPrice: "9.99" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe(clientId);
    expect(body.sku).toMatch(/^SKU-\d{6}$/);
  });

  it("POST is idempotent on a client-supplied id -- a resubmission returns the existing product, not a duplicate", async () => {
    const clientId = "22222222-2222-2222-2222-222222222222";
    const body = { id: clientId, nameEn: "Retried Offline Product", unitPrice: "5" };
    const makeRequest = () => new Request("http://localhost/api/products", { method: "POST", body: JSON.stringify(body) });

    const first = await POST(makeRequest());
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await POST(makeRequest());
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.sku).toBe(firstBody.sku);

    const count = await withTenant(tenantId, (tx) => tx.product.count({ where: { id: clientId } }));
    expect(count).toBe(1);
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

  it("POST stores an explicit VAT rate of 0 distinctly from no override", async () => {
    const request = new Request("http://localhost/api/products", {
      method: "POST",
      body: JSON.stringify({ nameEn: "Exempt Item", unitPrice: "10", vatRate: "0" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vatRate).not.toBeNull();
    expect(Number(body.vatRate)).toBe(0);
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

  it("POST allows the same barcode across two different tenants, with independent SKU counters", async () => {
    mockSession = { user: { tenantId: otherTenantId, role: "OWNER" } };
    try {
      const request = new Request("http://localhost/api/products", {
        method: "POST",
        body: JSON.stringify({ nameEn: "Cross Tenant Same Barcode", unitPrice: "10", barcode: "1111111111" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
      const body = await response.json();
      // otherTenantId's beforeAll fixture was created via a direct tx.product.create() call,
      // bypassing generateNextSku, so its counter never advanced past the default of 1 -- this
      // is genuinely otherTenantId's *first* generated SKU, proving the counters are separate
      // per tenant rather than one shared sequence (which would have produced a much higher
      // number here, since tenantId's counter has already advanced several times by this point).
      expect(body.sku).toBe("SKU-000001");
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("POST allows multiple products with no barcode", async () => {
    const first = await POST(
      new Request("http://localhost/api/products", { method: "POST", body: JSON.stringify({ nameEn: "No Barcode One", unitPrice: "1" }) })
    );
    const second = await POST(
      new Request("http://localhost/api/products", { method: "POST", body: JSON.stringify({ nameEn: "No Barcode Two", unitPrice: "1" }) })
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
      mockSession = { user: { tenantId, role: "OWNER" } };
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
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("POST returns 403 for a Cashier when the Owner has turned off cashierCanManageCatalog", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/products", {
        method: "POST",
        body: JSON.stringify({ nameEn: "Cashier Blocked Product", unitPrice: "1" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });

  it("POST allows a Cashier when cashierCanManageCatalog is left at its default", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/products", {
        method: "POST",
        body: JSON.stringify({ nameEn: "Cashier Allowed Product", unitPrice: "1" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });
});
