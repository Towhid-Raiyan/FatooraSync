import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { seedTenant } from "@/lib/db/seed-tenant";
import { applyStockMovement } from "./apply-stock-movement";

let tenantId: string;
let userId: string;
let productId: string;
let supplierId: string;

describe("applyStockMovement", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const seeded = await seedTenant({
      legalName: "Apply Stock Movement Test Co",
      tradeNameEn: "Apply Stock Movement Shop",
      vatNumber: `30000000000${uniqueId.toString().slice(-4)}`,
      ownerEmail: `applystockmovement+${uniqueId}@example.com`,
      ownerPassword: "TestPass123!",
    });
    tenantId = seeded.tenant.id;
    userId = seeded.user.id;

    const product = await prisma.product.create({
      data: { tenantId, nameEn: "Test Product", unitPrice: 10, quantity: 50 },
    });
    productId = product.id;

    const supplier = await prisma.supplier.create({ data: { tenantId, name: "Test Supplier" } });
    supplierId = supplier.id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.supplier.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("increments quantity and writes a RESTOCK movement with the resulting stock snapshot", async () => {
    const { product, movement } = await prisma.$transaction((txn) =>
      applyStockMovement(txn, {
        tenantId,
        productId,
        type: "RESTOCK",
        quantityDelta: 20,
        createdByUserId: userId,
        unitCost: 5.5,
        supplierId,
        note: "delivery invoice #123",
      })
    );

    expect(Number(product.quantity)).toBe(70);
    expect(movement.type).toBe("RESTOCK");
    expect(Number(movement.quantityDelta)).toBe(20);
    expect(Number(movement.quantityAfter)).toBe(70);
    expect(Number(movement.unitCost)).toBe(5.5);
    expect(movement.supplierId).toBe(supplierId);
    expect(movement.note).toBe("delivery invoice #123");
    expect(movement.reason).toBeNull();
    expect(movement.createdByUserId).toBe(userId);

    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(Number(refreshed.quantity)).toBe(70);
  });

  it("decrements quantity for a negative delta (a sale) and links the source document type", async () => {
    const { product, movement } = await prisma.$transaction((txn) =>
      applyStockMovement(txn, {
        tenantId,
        productId,
        type: "SALE",
        quantityDelta: -3,
        createdByUserId: userId,
      })
    );

    expect(Number(product.quantity)).toBe(67);
    expect(movement.type).toBe("SALE");
    expect(Number(movement.quantityDelta)).toBe(-3);
    expect(Number(movement.quantityAfter)).toBe(67);
  });

  it("writes an ADJUSTMENT movement with a reason and can move stock in either direction", async () => {
    const { movement } = await prisma.$transaction((txn) =>
      applyStockMovement(txn, {
        tenantId,
        productId,
        type: "ADJUSTMENT",
        quantityDelta: -5,
        createdByUserId: userId,
        reason: "DAMAGE",
        note: "crate damaged in storage",
      })
    );

    expect(movement.type).toBe("ADJUSTMENT");
    expect(movement.reason).toBe("DAMAGE");
    expect(Number(movement.quantityDelta)).toBe(-5);

    const { movement: recount } = await prisma.$transaction((txn) =>
      applyStockMovement(txn, {
        tenantId,
        productId,
        type: "ADJUSTMENT",
        quantityDelta: 2,
        createdByUserId: userId,
        reason: "RECOUNT",
      })
    );
    expect(Number(recount.quantityDelta)).toBe(2);
  });

  it("never updates or creates a movement for a product belonging to a different tenant", { timeout: 20000 }, async () => {
    const otherUniqueId = Date.now() + 1;
    const otherSeeded = await seedTenant({
      legalName: "Other Tenant Co",
      tradeNameEn: "Other Tenant Shop",
      vatNumber: `30000000000${otherUniqueId.toString().slice(-4)}`,
      ownerEmail: `otherapplystockmovement+${otherUniqueId}@example.com`,
      ownerPassword: "TestPass123!",
    });

    await expect(
      prisma.$transaction((txn) =>
        applyStockMovement(txn, {
          tenantId: otherSeeded.tenant.id,
          productId, // belongs to `tenantId`, not `otherSeeded.tenant.id`
          type: "RESTOCK",
          quantityDelta: 10,
          createdByUserId: otherSeeded.user.id,
        })
      )
    ).rejects.toThrow();

    const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(Number(unchanged.quantity)).toBe(64); // unaffected by the rejected cross-tenant attempt (50 +20 -3 -5 +2 from the earlier tests)

    await prisma.customer.deleteMany({ where: { tenantId: otherSeeded.tenant.id } });
    await prisma.settings.deleteMany({ where: { tenantId: otherSeeded.tenant.id } });
    await prisma.user.deleteMany({ where: { tenantId: otherSeeded.tenant.id } });
    await prisma.tenant.delete({ where: { id: otherSeeded.tenant.id } });
  });
});
