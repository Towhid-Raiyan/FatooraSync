import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET, PATCH } from "./route";

let tenantId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("/api/settings", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Settings Test Co", tradeNameEn: "Settings Test Shop", vatNumber: "300000000000006" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
  });

  afterAll(async () => {
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("GET returns the tenant's settings", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.defaultVatRate).toBe("15");
    expect(body.language).toBe("en");
  });

  it("PATCH updates the tenant's settings", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "10", language: "en", printFormat: "THERMAL", phone: "", cashierCanManageCatalog: true }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const after = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
    expect(after.defaultVatRate.toString()).toBe("10");
    expect(after.language).toBe("en");
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

  it("PATCH returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const request = new Request("http://localhost/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ defaultVatRate: "10", language: "en" }),
      });
      const response = await PATCH(request);
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("PATCH returns 400 for an out-of-range VAT rate", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "150", language: "en" }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(400);
  });

  it("PATCH returns 400 for a non-numeric VAT rate", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "not-a-number", language: "en" }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(400);
  });

  it("PATCH returns 400 for an invalid language", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "10", language: "fr" }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(400);
  });

  it("GET returns the default printFormat and a null phone for a fresh tenant", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.printFormat).toBe("THERMAL");
    expect(body.phone).toBeNull();
  });

  it("PATCH updates printFormat and phone", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "15", language: "ar", printFormat: "A4", phone: "+966501234567", cashierCanManageCatalog: true }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const afterSettings = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
    expect(afterSettings.printFormat).toBe("A4");
    const afterTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(afterTenant.phone).toBe("+966501234567");
  });

  it("PATCH clears the phone to null when an empty string is submitted", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "15", language: "ar", printFormat: "THERMAL", phone: "", cashierCanManageCatalog: true }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const afterTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(afterTenant.phone).toBeNull();
  });

  it("PATCH returns 400 for an invalid printFormat", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "15", language: "ar", printFormat: "ROLL" }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(400);
  });

  it("PATCH returns 403 when the caller is a Cashier, not an Owner", async () => {
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const request = new Request("http://localhost/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ defaultVatRate: "10", language: "en", printFormat: "THERMAL", phone: "", cashierCanManageCatalog: true }),
      });
      const response = await PATCH(request);
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("PATCH persists cashierCanManageCatalog: false", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate: "15", language: "ar", printFormat: "THERMAL", phone: "", cashierCanManageCatalog: false }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);

    const after = await withTenant(tenantId, (tx) => tx.settings.findUniqueOrThrow({ where: { tenantId } }));
    expect(after.cashierCanManageCatalog).toBe(false);

    // Restore, since later tests in this file assume the default.
    await withTenant(tenantId, (tx) => tx.settings.update({ where: { tenantId }, data: { cashierCanManageCatalog: true } }));
  });
});
