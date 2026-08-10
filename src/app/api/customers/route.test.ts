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

describe("/api/customers", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Customers Test Co", tradeNameEn: "Customers Test Shop", vatNumber: "300000000000013" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Co", tradeNameEn: "Other Shop", vatNumber: "300000000000020" },
    });
    otherTenantId = otherTenant.id;
    await withTenant(otherTenantId, (tx) => tx.customer.create({ data: { name: "Other Tenant's Customer" } as Prisma.CustomerUncheckedCreateInput }));
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("POST creates a customer with valid data", async () => {
    const request = new Request("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Acme Trading", vatId: "300000000000037", phone: "0555555555" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe("Acme Trading");
    expect(body.vatId).toBe("300000000000037");
  });

  it("GET returns only this tenant's customers, never another tenant's", async () => {
    const response = await GET();
    const body = await response.json();
    const names = body.map((c: { name: string }) => c.name);
    expect(names).toContain("Acme Trading");
    expect(names).not.toContain("Other Tenant's Customer");
  });

  it("POST returns 400 for an empty name", async () => {
    const request = new Request("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("POST returns 409 for a VAT ID already used within the same tenant", async () => {
    const request = new Request("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Duplicate Vat Co", vatId: "300000000000037" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
  });

  it("POST allows the same VAT ID across two different tenants", async () => {
    mockSession = { user: { tenantId: otherTenantId } };
    try {
      const request = new Request("http://localhost/api/customers", {
        method: "POST",
        body: JSON.stringify({ name: "Cross Tenant Same Vat", vatId: "300000000000037" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("POST allows multiple customers with no VAT ID", async () => {
    const first = await POST(
      new Request("http://localhost/api/customers", { method: "POST", body: JSON.stringify({ name: "No Vat One" }) })
    );
    const second = await POST(
      new Request("http://localhost/api/customers", { method: "POST", body: JSON.stringify({ name: "No Vat Two" }) })
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
      const request = new Request("http://localhost/api/customers", {
        method: "POST",
        body: JSON.stringify({ name: "Should Not Be Created" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });
});
