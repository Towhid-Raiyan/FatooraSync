import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST } from "./route";

const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

let ctoId: string;
let developerId: string;
let mockSession: { user: { agencyStaffId: string; role: string } } | null = null;

vi.mock("@/lib/admin-auth/get-admin-session", () => ({
  getAdminSession: async () => mockSession,
}));

// Failure-injection switches for the ordered-flow tests below (spec S8:
// "each failure-injection case ... confirming the tenant and all its data
// are provably untouched afterward"). Each mock calls straight through to
// the real implementation unless its switch is on, so the happy-path test
// and the 403/401/404 tests are unaffected by this mocking.
const inject = { gather: false, build: false, upload: false };

vi.mock("@/lib/tenant-deletion/gather-tenant-data", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-deletion/gather-tenant-data")>(
    "@/lib/tenant-deletion/gather-tenant-data"
  );
  return {
    gatherTenantData: async (...args: Parameters<typeof actual.gatherTenantData>) => {
      if (inject.gather) throw new Error("Injected gather failure");
      return actual.gatherTenantData(...args);
    },
  };
});

vi.mock("@/lib/tenant-deletion/build-archive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-deletion/build-archive")>(
    "@/lib/tenant-deletion/build-archive"
  );
  return {
    buildTenantArchive: async (...args: Parameters<typeof actual.buildTenantArchive>) => {
      if (inject.build) throw new Error("Injected build failure");
      return actual.buildTenantArchive(...args);
    },
  };
});

vi.mock("@/lib/tenant-deletion/upload-archive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-deletion/upload-archive")>(
    "@/lib/tenant-deletion/upload-archive"
  );
  return {
    uploadTenantArchive: async (...args: Parameters<typeof actual.uploadTenantArchive>) => {
      if (inject.upload) throw new Error("Injected upload failure");
      return actual.uploadTenantArchive(...args);
    },
  };
});

function req() {
  return new Request("http://localhost/api/admin/tenants/x/delete", { method: "POST" });
}

async function createTestTenant(vatNumber: string) {
  const tenant = await prisma.tenant.create({
    data: { legalName: "Failure Injection Co", tradeNameEn: "Failure Injection Shop", vatNumber },
  });
  await withTenant(tenant.id, (tx) => tx.settings.create({ data: { tenantId: tenant.id } }));
  return tenant;
}

describe("POST /api/admin/tenants/[id]/delete", () => {
  beforeAll(async () => {
    const cto = await prisma.agencyStaff.create({ data: { email: `cto-${Date.now()}@test.local`, passwordHash: "x", role: "CTO" } });
    ctoId = cto.id;
    const dev = await prisma.agencyStaff.create({ data: { email: `dev-${Date.now()}@test.local`, passwordHash: "x", role: "DEVELOPER" } });
    developerId = dev.id;
    mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
  }, 30000);

  afterAll(async () => {
    await prisma.tenantArchive.deleteMany({ where: { deletedByAgencyStaffId: { in: [ctoId, developerId] } } });
    await prisma.agencyStaff.deleteMany({ where: { id: { in: [ctoId, developerId] } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    inject.gather = false;
    inject.build = false;
    inject.upload = false;
  });

  it("leaves the tenant and all its data untouched when gathering fails", { timeout: 30000 }, async () => {
    const tenant = await createTestTenant("300000000000787");
    try {
      inject.gather = true;
      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(500);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).not.toBeNull();
      const archiveCount = await prisma.tenantArchive.count({ where: { originalTenantId: tenant.id } });
      expect(archiveCount).toBe(0);
    } finally {
      await prisma.settings.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it("leaves the tenant and all its data untouched when building the archive fails", { timeout: 30000 }, async () => {
    const tenant = await createTestTenant("300000000000794");
    try {
      inject.build = true;
      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(500);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).not.toBeNull();
      const archiveCount = await prisma.tenantArchive.count({ where: { originalTenantId: tenant.id } });
      expect(archiveCount).toBe(0);
    } finally {
      await prisma.settings.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it("returns a clean 500, not an unhandled rejection, when the delete transaction fails", { timeout: 30000 }, async () => {
    const tenant = await createTestTenant("300000000000961");
    const transactionSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("Injected transaction failure"));
    try {
      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBeDefined();

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).not.toBeNull();
      const archiveCount = await prisma.tenantArchive.count({ where: { originalTenantId: tenant.id } });
      expect(archiveCount).toBe(0);
    } finally {
      transactionSpy.mockRestore();
      await prisma.settings.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it("leaves the tenant and all its data untouched when the upload fails to verify", { timeout: 30000 }, async () => {
    const tenant = await createTestTenant("300000000000800");
    try {
      inject.upload = true;
      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(500);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).not.toBeNull();
      const archiveCount = await prisma.tenantArchive.count({ where: { originalTenantId: tenant.id } });
      expect(archiveCount).toBe(0);
    } finally {
      await prisma.settings.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it.skipIf(!hasBlobToken)(
    "cascades through every tenant-scoped table, not just the ones exercised elsewhere",
    { timeout: 30000 },
    async () => {
      const tenant = await prisma.tenant.create({
        data: { legalName: "Full Cascade Co", tradeNameEn: "Full Cascade Shop", vatNumber: "300000000000817" },
      });
      await withTenant(tenant.id, (tx) => tx.settings.create({ data: { tenantId: tenant.id } }));

      const product = await withTenant(tenant.id, (tx) =>
        tx.product.create({ data: { nameEn: "Cascade Product", sku: "SKU-FC-1", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput })
      );
      const customer = await withTenant(tenant.id, (tx) =>
        tx.customer.create({ data: { name: "Cascade Customer", isWalkIn: false } as Prisma.CustomerUncheckedCreateInput })
      );
      const supplier = await withTenant(tenant.id, (tx) =>
        tx.supplier.create({ data: { name: "Cascade Supplier" } as Prisma.SupplierUncheckedCreateInput })
      );
      const staffUser = await withTenant(tenant.id, (tx) =>
        tx.user.create({ data: { email: `cascade-${Date.now()}@test.local`, passwordHash: "x" } as Prisma.UserUncheckedCreateInput })
      );
      const receipt = await withTenant(tenant.id, (tx) =>
        tx.document.create({
          data: {
            type: "SALES_RECEIPT", number: 1, customerId: customer.id, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5,
            lines: { create: [{ tenantId: tenant.id, productId: product.id, productName: "Cascade Product", quantity: 1, unitPrice: 10, vatRate: 15, lineSubtotal: 10, lineVat: 1.5, lineTotal: 11.5 }] },
          } as Prisma.DocumentUncheckedCreateInput,
        })
      );
      const purchaseReceipt = await withTenant(tenant.id, (tx) =>
        tx.purchaseReceipt.create({
          data: {
            number: 1, supplierId: supplier.id, purchaseDate: new Date(), paymentMethod: "CASH", subtotal: 10, vatTotal: 1.5, grandTotal: 11.5,
            lines: { create: [{ tenantId: tenant.id, productId: product.id, productName: "Cascade Product", unit: "PIECE", quantity: 1, unitPrice: 10, vatRate: 15, lineSubtotal: 10, lineVat: 1.5, lineTotal: 11.5 }] },
          } as Prisma.PurchaseReceiptUncheckedCreateInput,
        })
      );
      await withTenant(tenant.id, (tx) =>
        tx.stockMovement.create({
          data: {
            productId: product.id, type: "RESTOCK", quantityDelta: 5, quantityAfter: 5,
            createdByUserId: staffUser.id, purchaseReceiptId: purchaseReceipt.id,
          } as Prisma.StockMovementUncheckedCreateInput,
        })
      );
      await prisma.numberLease.create({
        data: { tenantId: tenant.id, documentType: "SALES_RECEIPT", deviceId: "cascade-device", rangeStart: 1, rangeEnd: 100, nextToIssue: 2 } as Prisma.NumberLeaseUncheckedCreateInput,
      });

      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(200);

      const [settings, customers, products, suppliers, documents, documentLines, purchaseReceipts, purchaseReceiptLines, stockMovements, numberLeases, users] =
        await Promise.all([
          prisma.settings.count({ where: { tenantId: tenant.id } }),
          prisma.customer.count({ where: { tenantId: tenant.id } }),
          prisma.product.count({ where: { tenantId: tenant.id } }),
          prisma.supplier.count({ where: { tenantId: tenant.id } }),
          prisma.document.count({ where: { tenantId: tenant.id } }),
          prisma.documentLine.count({ where: { tenantId: tenant.id } }),
          prisma.purchaseReceipt.count({ where: { tenantId: tenant.id } }),
          prisma.purchaseReceiptLine.count({ where: { tenantId: tenant.id } }),
          prisma.stockMovement.count({ where: { tenantId: tenant.id } }),
          prisma.numberLease.count({ where: { tenantId: tenant.id } }),
          prisma.user.count({ where: { tenantId: tenant.id } }),
        ]);

      expect({ settings, customers, products, suppliers, documents, documentLines, purchaseReceipts, purchaseReceiptLines, stockMovements, numberLeases, users }).toEqual({
        settings: 0, customers: 0, products: 0, suppliers: 0, documents: 0, documentLines: 0,
        purchaseReceipts: 0, purchaseReceiptLines: 0, stockMovements: 0, numberLeases: 0, users: 0,
      });

      await prisma.tenantArchive.deleteMany({ where: { originalTenantId: tenant.id } });
    }
  );

  it.skipIf(!hasBlobToken)(
    "exports, verifies, tombstones, and deletes a tenant with data, on the happy path",
    { timeout: 30000 },
    async () => {
      const tenant = await prisma.tenant.create({
        data: { legalName: "Delete Route Co", tradeNameEn: "Delete Route Shop", vatNumber: "300000000000732" },
      });
      await withTenant(tenant.id, (tx) => tx.settings.create({ data: { tenantId: tenant.id } }));
      const customer = await withTenant(tenant.id, (tx) =>
        tx.customer.create({ data: { name: "Walk-in", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
      );
      await withTenant(tenant.id, (tx) =>
        tx.document.create({
          data: { type: "SALES_RECEIPT", number: 1, customerId: customer.id, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5 } as Prisma.DocumentUncheckedCreateInput,
        })
      );

      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.archiveId).toBeDefined();

      const archive = await prisma.tenantArchive.findUnique({ where: { id: body.archiveId } });
      expect(archive?.originalTenantId).toBe(tenant.id);
      expect(archive?.receiptCount).toBe(1);
      expect(archive?.archiveUrl).toMatch(/^https:\/\//);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).toBeNull();
      const orphanedCustomer = await prisma.customer.findUnique({ where: { id: customer.id } });
      expect(orphanedCustomer).toBeNull();
    }
  );

  it("returns 403 and leaves the tenant untouched for a DEVELOPER-role caller", { timeout: 30000 }, async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Forbidden Delete Co", tradeNameEn: "Forbidden Delete Shop", vatNumber: "300000000000749" },
    });
    try {
      mockSession = { user: { agencyStaffId: developerId, role: "DEVELOPER" } };
      const response = await POST(req(), { params: Promise.resolve({ id: tenant.id }) });
      expect(response.status).toBe(403);

      const stillThere = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(req(), { params: Promise.resolve({ id: "does-not-matter" }) });
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { agencyStaffId: ctoId, role: "CTO" } };
    }
  });

  it("returns 404 for a tenant that does not exist", { timeout: 30000 }, async () => {
    const response = await POST(req(), { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) });
    expect(response.status).toBe(404);
  });
});
