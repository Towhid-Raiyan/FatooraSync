import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { GET } from "./route";

let tenantId: string;
let otherTenantId: string;
let userId: string;
let receiptId: string;
let quotationId: string;
let lineAId: string;
let lineBId: string;
let mockSession: { user: { tenantId: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function req(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/receipts/[id]/creditable-lines", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const tenant = await prisma.tenant.create({
      data: { legalName: "Creditable Lines Co", tradeNameEn: "Creditable Lines Shop", vatNumber: `30000000000${uniqueId.toString().slice(-4)}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `creditable-lines-test+${uniqueId}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, id: userId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });
    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Creditable Product", unitPrice: 10, quantity: 100 } as Prisma.ProductUncheckedCreateInput })
    );

    const saveResponse = await createReceipt(
      new Request("http://localhost/api/receipts", {
        method: "POST",
        body: JSON.stringify({
          customer: { name: "", vatId: "" },
          lines: [
            { productId: product.id, quantity: "3" },
            { productId: product.id, quantity: "5" },
          ],
        }),
      })
    );
    const saved = await saveResponse.json();
    receiptId = saved.id;
    lineAId = saved.lines[0].id;
    lineBId = saved.lines[1].id;

    // Simulate a previously-issued credit note crediting 1 of line A's 3 units,
    // without going through the real POST /api/credit-notes route (that route
    // doesn't exist until Task 4) -- just enough of a DocumentLine row to
    // exercise the aggregation this route computes.
    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "CREDIT_NOTE",
          number: 1,
          customerId: saved.customerId,
          subtotal: 3.04,
          vatTotal: 0.46,
          grandTotal: 3.5,
          creditNoteOfDocumentId: receiptId,
          lines: {
            create: [
              {
                tenantId,
                productId: product.id,
                productName: "Creditable Product",
                quantity: 1,
                unitPrice: 10,
                discount: 0,
                vatRate: 15,
                lineSubtotal: 10,
                lineVat: 1.5,
                lineTotal: 11.5,
                creditedForLineId: lineAId,
              },
            ],
          },
        } as unknown as Prisma.DocumentUncheckedCreateInput,
      })
    );

    const quotation = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "QUOTATION",
          number: 1,
          customerId: saved.customerId,
          subtotal: 10,
          vatTotal: 1.5,
          grandTotal: 11.5,
        } as unknown as Prisma.DocumentUncheckedCreateInput,
      })
    );
    quotationId = quotation.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Co", tradeNameEn: "Other Shop", vatNumber: `30000000001${uniqueId.toString().slice(-4)}` },
    });
    otherTenantId = otherTenant.id;
  }, 30000);

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.documentLine.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  }, 30000);

  it("returns each line's original, credited, and remaining quantity", async () => {
    const response = await GET(new Request(`http://localhost/api/receipts/${receiptId}/creditable-lines`), req(receiptId));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.documentId).toBe(receiptId);
    const lineA = body.lines.find((l: { id: string }) => l.id === lineAId);
    const lineB = body.lines.find((l: { id: string }) => l.id === lineBId);
    expect(lineA).toMatchObject({ quantity: 3, creditedQuantity: 1, remainingQuantity: 2 });
    expect(lineB).toMatchObject({ quantity: 5, creditedQuantity: 0, remainingQuantity: 5 });
  });

  it("404s for a document belonging to another tenant", async () => {
    mockSession = { user: { tenantId: otherTenantId, id: userId } };
    const response = await GET(new Request(`http://localhost/api/receipts/${receiptId}/creditable-lines`), req(receiptId));
    expect(response.status).toBe(404);
    mockSession = { user: { tenantId, id: userId } };
  });

  it("404s for a quotation (not a sales receipt)", async () => {
    const response = await GET(new Request(`http://localhost/api/receipts/${quotationId}/creditable-lines`), req(quotationId));
    expect(response.status).toBe(404);
  });

  it("401s when unauthenticated", async () => {
    mockSession = null;
    const response = await GET(new Request(`http://localhost/api/receipts/${receiptId}/creditable-lines`), req(receiptId));
    expect(response.status).toBe(401);
    mockSession = { user: { tenantId, id: userId } };
  });
});
