import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { gatherTenantData } from "./gather-tenant-data";

let tenantId: string;

describe("gatherTenantData", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Gather Test Co", tradeNameEn: "Gather Test Shop", vatNumber: "300000000000701" },
    });
    tenantId = tenant.id;
    await withTenant(tenantId, (tx) => tx.settings.create({ data: { tenantId } }));

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Gathered Product", sku: "SKU-GT-1", unitPrice: 10, quantity: 5 } as Prisma.ProductUncheckedCreateInput })
    );
    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    await withTenant(tenantId, (tx) =>
      tx.user.create({ data: { email: `gather-${Date.now()}@test.local`, passwordHash: "hashed-secret" } as Prisma.UserUncheckedCreateInput })
    );
    await prisma.numberLease.create({
      data: { tenantId, documentType: "SALES_RECEIPT", deviceId: "gather-device", rangeStart: 1, rangeEnd: 100, nextToIssue: 1 } as Prisma.NumberLeaseUncheckedCreateInput,
    });
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          type: "SALES_RECEIPT",
          number: 1,
          customerId: customer.id,
          subtotal: 10,
          vatTotal: 1.5,
          grandTotal: 11.5,
          lines: { create: [{ tenantId, productId: product.id, productName: "Gathered Product", quantity: 1, unitPrice: 10, vatRate: 15, lineSubtotal: 10, lineVat: 1.5, lineTotal: 11.5 }] },
        } as Prisma.DocumentUncheckedCreateInput,
      })
    );
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: { type: "QUOTATION", number: 1, customerId: customer.id, subtotal: 10, vatTotal: 1.5, grandTotal: 11.5 } as Prisma.DocumentUncheckedCreateInput,
      })
    );
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          type: "CREDIT_NOTE",
          number: 1,
          customerId: customer.id,
          subtotal: 10,
          vatTotal: 1.5,
          grandTotal: 11.5,
          lines: { create: [{ tenantId, productId: product.id, productName: "Gathered Product", quantity: 1, unitPrice: 10, vatRate: 15, lineSubtotal: 10, lineVat: 1.5, lineTotal: 11.5 }] },
        } as Prisma.DocumentUncheckedCreateInput,
      })
    );
  }, 30000);

  afterAll(async () => {
    await prisma.documentLine.deleteMany({ where: { tenantId } });
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.numberLease.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("gathers every tenant-scoped table and the right summary counts", { timeout: 30000 }, async () => {
    const data = await gatherTenantData(tenantId);

    expect(data.tenant.tradeNameEn).toBe("Gather Test Shop");
    expect(data.settings).not.toBeNull();
    expect(data.settings?.tenantId).toBe(tenantId);
    expect(data.users).toHaveLength(1);
    expect(data.users[0]).not.toHaveProperty("passwordHash");
    expect(data.users[0].email).toMatch(/@test\.local$/);
    expect(data.numberLeases).toHaveLength(1);
    expect(data.numberLeases[0].deviceId).toBe("gather-device");
    expect(data.products).toHaveLength(1);
    expect(data.customers).toHaveLength(1);
    expect(data.receipts).toHaveLength(1);
    expect(data.quotations).toHaveLength(1);
    expect(data.creditNotes).toHaveLength(1);
    expect(data.receipts[0].lines).toHaveLength(1);
    expect(data.creditNotes[0].lines).toHaveLength(1);
    expect(data.summary.receiptCount).toBe(1);
    expect(data.summary.quotationCount).toBe(1);
    expect(data.summary.creditNoteCount).toBe(1);
    expect(data.summary.earliestDocumentAt).not.toBeNull();
    expect(data.summary.latestDocumentAt).not.toBeNull();
  });

  it("returns zeroed summary counts and empty arrays for a tenant with no documents", { timeout: 30000 }, async () => {
    const empty = await prisma.tenant.create({
      data: { legalName: "Empty Gather Co", tradeNameEn: "Empty Gather Shop", vatNumber: "300000000000718" },
    });
    try {
      const data = await gatherTenantData(empty.id);
      expect(data.receipts).toHaveLength(0);
      expect(data.creditNotes).toHaveLength(0);
      expect(data.summary.receiptCount).toBe(0);
      expect(data.summary.creditNoteCount).toBe(0);
      expect(data.summary.earliestDocumentAt).toBeNull();
      expect(data.settings).toBeNull();
      expect(data.users).toHaveLength(0);
      expect(data.numberLeases).toHaveLength(0);
    } finally {
      await prisma.tenant.delete({ where: { id: empty.id } });
    }
  });
});
