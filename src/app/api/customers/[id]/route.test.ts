import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { PATCH, DELETE } from "./route";

let tenantId: string;
let otherTenantId: string;
let customerId: string;
let walkInId: string;
let otherTenantCustomerId: string;
let customerWithoutVatId: string;
let mockSession: { user: { tenantId: string; role: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/customers/x", { method: "PATCH", body: JSON.stringify(body) });
}

function deleteRequest() {
  return new Request("http://localhost/api/customers/x", { method: "DELETE" });
}

describe("/api/customers/[id]", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Customer Patch Test Co", tradeNameEn: "Customer Patch Shop", vatNumber: "300000000000044" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId, role: "OWNER" } };

    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Editable Customer", phone: "0500000000" } as Prisma.CustomerUncheckedCreateInput })
    );
    customerId = customer.id;

    const walkIn = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    walkInId = walkIn.id;

    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Customer With VAT", vatId: "300000000000088" } as Prisma.CustomerUncheckedCreateInput })
    );

    const custWithoutVat = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Customer Without VAT" } as Prisma.CustomerUncheckedCreateInput })
    );
    customerWithoutVatId = custWithoutVat.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Patch Co", tradeNameEn: "Other Patch Shop", vatNumber: "300000000000051" },
    });
    otherTenantId = otherTenant.id;
    const otherCustomer = await withTenant(otherTenantId, (tx) =>
      tx.customer.create({ data: { name: "Other Tenant Customer" } as Prisma.CustomerUncheckedCreateInput })
    );
    otherTenantCustomerId = otherCustomer.id;
  });

  afterAll(async () => {
    // Document references Customer via a RESTRICT foreign key (the "returns 409" test
    // below creates one), so it must be cleaned up before the customers it points at.
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("updates an editable customer's fields", async () => {
    const response = await PATCH(patchRequest({ name: "Renamed Customer", phone: "0511111111" }), {
      params: Promise.resolve({ id: customerId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Renamed Customer");
    expect(body.phone).toBe("0511111111");
  });

  it("deactivates then reactivates a customer", async () => {
    const deactivate = await PATCH(patchRequest({ isActive: false }), {
      params: Promise.resolve({ id: customerId }),
    });
    expect(deactivate.status).toBe(200);
    expect((await deactivate.json()).isActive).toBe(false);

    const reactivate = await PATCH(patchRequest({ isActive: true }), {
      params: Promise.resolve({ id: customerId }),
    });
    expect(reactivate.status).toBe(200);
    expect((await reactivate.json()).isActive).toBe(true);
  });

  it("returns 403 when targeting the Walk-in Customer", async () => {
    const response = await PATCH(patchRequest({ isActive: false }), { params: Promise.resolve({ id: walkInId }) });
    expect(response.status).toBe(403);
  });

  it("returns 403 when targeting the Walk-in Customer with different body shape", async () => {
    const response = await PATCH(patchRequest({ name: "Should not work" }), { params: Promise.resolve({ id: walkInId }) });
    expect(response.status).toBe(403);
  });

  it("returns 404 for a nonexistent id", async () => {
    const response = await PATCH(patchRequest({ name: "Nope" }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for a customer belonging to another tenant", async () => {
    const response = await PATCH(patchRequest({ name: "Should not work" }), {
      params: Promise.resolve({ id: otherTenantCustomerId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 400 when clearing the name to empty", async () => {
    const response = await PATCH(patchRequest({ name: "   " }), { params: Promise.resolve({ id: customerId }) });
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await PATCH(patchRequest({ name: "Nope" }), { params: Promise.resolve({ id: customerId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });

  it("returns 409 when updating vatId to one already used in the same tenant", async () => {
    const response = await PATCH(patchRequest({ vatId: "300000000000088" }), {
      params: Promise.resolve({ id: customerWithoutVatId }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("This VAT ID is already used by another customer");
  });

  it("PATCH returns 403 for a Cashier when the Owner has turned off cashierCanManageCatalog", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId, cashierCanManageCatalog: false } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await PATCH(patchRequest({ name: "Cashier Blocked Update" }), {
        params: Promise.resolve({ id: customerId }),
      });
      expect(response.status).toBe(403);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });

  it("PATCH allows a Cashier when cashierCanManageCatalog is left at its default", async () => {
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));
    mockSession = { user: { tenantId, role: "CASHIER" } };
    try {
      const response = await PATCH(patchRequest({ name: "Cashier Blocked Update" }), {
        params: Promise.resolve({ id: customerId }),
      });
      expect(response.status).toBe(200);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
      await prisma.settings.deleteMany({ where: { tenantId } });
    }
  });

  it("deletes a customer with no history", async () => {
    const disposable = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Disposable Customer" } as Prisma.CustomerUncheckedCreateInput })
    );
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: disposable.id }) });
    expect(response.status).toBe(200);
    const found = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: disposable.id } }));
    expect(found).toBeNull();
  });

  it("DELETE returns 404 for a nonexistent id", async () => {
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });

  it("DELETE returns 404 for a customer belonging to another tenant", async () => {
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: otherTenantCustomerId }) });
    expect(response.status).toBe(404);
  });

  it("DELETE returns 403 when targeting the Walk-in Customer", async () => {
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: walkInId }) });
    expect(response.status).toBe(403);
  });

  it("returns 409 with a friendly error when the customer has document history", async () => {
    const referenced = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Referenced Customer" } as Prisma.CustomerUncheckedCreateInput })
    );
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "SALES_RECEIPT",
          number: 900002,
          customerId: referenced.id,
          subtotal: 4,
          vatTotal: 0.6,
          grandTotal: 4.6,
        } as Prisma.DocumentUncheckedCreateInput,
      })
    );

    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: referenced.id }) });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("can't be deleted");
  });

  it("DELETE returns 401 when unauthenticated", async () => {
    mockSession = null;
    try {
      const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: customerId }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, role: "OWNER" } };
    }
  });
});
