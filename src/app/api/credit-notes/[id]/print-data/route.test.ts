import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { POST as createCreditNote } from "@/app/api/credit-notes/route";
import { GET } from "./route";

let tenantId: string;
let userId: string;
let creditNoteId: string;
let mockSession: { user: { tenantId: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

describe("GET /api/credit-notes/[id]/print-data", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const tenant = await prisma.tenant.create({
      data: { legalName: "Credit Note Print Co", tradeNameEn: "Credit Note Print Shop", tradeNameAr: "متجر إشعار الدائن", vatNumber: `30000000003${uniqueId.toString().slice(-4)}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `credit-note-print-test+${uniqueId}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, id: userId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });
    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Print Data Product", unitPrice: 10, quantity: 20 } as Prisma.ProductUncheckedCreateInput })
    );

    const receiptResponse = await createReceipt(
      new Request("http://localhost/api/receipts", {
        method: "POST",
        body: JSON.stringify({ customer: { name: "", vatId: "" }, lines: [{ productId: product.id, quantity: "2" }] }),
      })
    );
    const receipt = await receiptResponse.json();

    const creditNoteResponse = await createCreditNote(
      new Request("http://localhost/api/credit-notes", {
        method: "POST",
        body: JSON.stringify({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 2 }] }),
      })
    );
    const creditNote = await creditNoteResponse.json();
    creditNoteId = creditNote.id;
  }, 30000);

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.documentLine.deleteMany({ where: { tenantId } });
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.settings.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  }, 30000);

  it("returns the credit note's print data", async () => {
    const response = await GET(
      new Request(`http://localhost/api/credit-notes/${creditNoteId}/print-data`),
      { params: Promise.resolve({ id: creditNoteId }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.document.number).toBe(1);
    expect(body.document.lines).toHaveLength(1);
  });

  it("404s when the id is a receipt, not a credit note", async () => {
    const receipt = await withTenant(tenantId, (tx) => tx.document.findFirstOrThrow({ where: { type: "SALES_RECEIPT" } }));
    const response = await GET(
      new Request(`http://localhost/api/credit-notes/${receipt.id}/print-data`),
      { params: Promise.resolve({ id: receipt.id }) }
    );
    expect(response.status).toBe(404);
  });
});
