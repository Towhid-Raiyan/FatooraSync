import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { POST as createReceipt } from "@/app/api/receipts/route";
import { POST } from "./route";

let tenantId: string;
let userId: string;
let productId: string;
let mockSession: { user: { tenantId: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/credit-notes", { method: "POST", body: JSON.stringify(body) });
}

async function seedReceipt(quantities: number[]) {
  const response = await createReceipt(
    new Request("http://localhost/api/receipts", {
      method: "POST",
      body: JSON.stringify({
        customer: { name: "", vatId: "" },
        lines: quantities.map((quantity) => ({ productId, quantity: String(quantity) })),
      }),
    })
  );
  return response.json();
}

describe("POST /api/credit-notes", () => {
  beforeAll(async () => {
    const uniqueId = Date.now();
    const tenant = await prisma.tenant.create({
      data: { legalName: "Credit Note Route Co", tradeNameEn: "Credit Note Route Shop", vatNumber: `30000000002${uniqueId.toString().slice(-4)}` },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `credit-note-route-test+${uniqueId}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, id: userId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });
    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Credit Note Product", unitPrice: 10, quantity: 1000 } as Prisma.ProductUncheckedCreateInput })
    );
    productId = product.id;
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

  it(
    "fully credits a single-line receipt, restores stock, and chains the invoice hash",
    { timeout: 20000 },
    async () => {
      const receipt = await seedReceipt([2]);
      const productBefore = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));

      const response = await POST(
        postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 2 }] })
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.type).toBe("CREDIT_NOTE");
      expect(body.creditNoteOfDocumentId).toBe(receipt.id);
      expect(body.previousInvoiceHash).toBe(receipt.invoiceHash);
      expect(Number(body.grandTotal)).toBe(Number(receipt.grandTotal));

      const productAfter = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
      expect(Number(productAfter.quantity)).toBe(Number(productBefore.quantity) + 2);

      const movement = await withTenant(tenantId, (tx) =>
        tx.stockMovement.findFirst({ where: { documentId: body.id, type: "RETURN" } })
      );
      expect(movement).toBeTruthy();
      expect(Number(movement!.quantityDelta)).toBe(2);

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant.lastInvoiceHash).toBe(body.invoiceHash);
    }
  );

  it(
    "fully credits a line where the cashier typed a Total, reconciling exactly to the original (no off-by-a-cent)",
    { timeout: 20000 },
    async () => {
      // 3 units, a typed lineTotal of 12.00, default 15% VAT: this is the exact
      // combination calculateLineFromTotal's own comment cites as one where the
      // subtotal-first math (calculateLine, working forward from the back-solved
      // unitPrice) can't land on 12.00 -- it lands on 11.99 instead. A full credit
      // that recomputes forward from the stored unitPrice would therefore produce
      // a credit note that's 1 cent short of the receipt it's crediting.
      const response = await createReceipt(
        new Request("http://localhost/api/receipts", {
          method: "POST",
          body: JSON.stringify({
            customer: { name: "", vatId: "" },
            lines: [{ productId, quantity: "3", lineTotal: "12.00" }],
          }),
        })
      );
      const receipt = await response.json();
      expect(Number(receipt.lines[0].lineTotal)).toBe(12);

      const creditResponse = await POST(
        postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 3 }] })
      );
      expect(creditResponse.status).toBe(201);
      const creditNote = await creditResponse.json();

      expect(Number(creditNote.lines[0].lineTotal)).toBe(Number(receipt.lines[0].lineTotal));
      expect(Number(creditNote.grandTotal)).toBe(Number(receipt.grandTotal));
    }
  );

  it("partially credits one line of a multi-line receipt", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([3, 5]);
    const response = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines).toHaveLength(1);
    expect(Number(body.lines[0].quantity)).toBe(1);
    expect(body.lines[0].creditedForLineId).toBe(receipt.lines[0].id);
  });

  it("rejects crediting more than what remains on a line", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([2]);
    const response = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 3 }] })
    );
    expect(response.status).toBe(400);
  });

  it(
    "under two truly concurrent requests crediting the same line's last unit, exactly one succeeds",
    { timeout: 20000 },
    async () => {
      const receipt = await seedReceipt([1]);
      const [first, second] = await Promise.all([
        POST(postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })),
        POST(postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })),
      ]);
      const statuses = [first.status, second.status].sort();
      // The tenant-row lock (taken via the nextCreditNoteNumber increment, before
      // either transaction re-reads how much of the line is already credited)
      // serializes these two transactions -- whichever commits first sees the
      // line as untouched and succeeds; the other re-reads after that commit,
      // sees the line fully credited, and is rejected. Both succeeding would
      // mean the line was credited twice for a receipt that only had 1 unit.
      expect(statuses).toEqual([201, 400]);
    }
  );

  it("rejects a second credit note that would exceed what's left after a prior one", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([2]);
    const first = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })
    );
    expect(first.status).toBe(201);
    const second = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 2 }] })
    );
    expect(second.status).toBe(400);
  });

  it("rejects a single request that repeats the same line and together over-credits it", { timeout: 20000 }, async () => {
    // A receipt with only 1 unit remaining on the line: two entries in the same
    // request each individually ask for 1 (each passing a naive "1 > 1 is
    // false" check on its own), but together they ask for 2 -- more than the
    // line has. This must be rejected as a whole, not split into one accepted
    // and one rejected line within a single credit note.
    const receipt = await seedReceipt([1]);
    const response = await POST(
      postRequest({
        originalDocumentId: receipt.id,
        lines: [
          { originalLineId: receipt.lines[0].id, quantity: 1 },
          { originalLineId: receipt.lines[0].id, quantity: 1 },
        ],
      })
    );
    expect(response.status).toBe(400);
  });

  it("rejects an originalLineId that belongs to a different receipt", { timeout: 20000 }, async () => {
    const receiptA = await seedReceipt([2]);
    const receiptB = await seedReceipt([2]);
    const response = await POST(
      postRequest({ originalDocumentId: receiptA.id, lines: [{ originalLineId: receiptB.lines[0].id, quantity: 1 }] })
    );
    expect(response.status).toBe(400);
  });

  it("rejects crediting a credit note (not a sales receipt)", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([2]);
    const creditNoteResponse = await POST(
      postRequest({ originalDocumentId: receipt.id, lines: [{ originalLineId: receipt.lines[0].id, quantity: 1 }] })
    );
    const creditNote = await creditNoteResponse.json();
    const secondCreditNote = await withTenant(tenantId, (tx) =>
      tx.document.findFirstOrThrow({ where: { id: creditNote.id }, include: { lines: true } })
    );
    const response = await POST(
      postRequest({
        originalDocumentId: secondCreditNote.id,
        lines: [{ originalLineId: secondCreditNote.lines[0].id, quantity: 1 }],
      })
    );
    expect(response.status).toBe(404);
  });

  it("rejects crediting a quotation", { timeout: 20000 }, async () => {
    const customer = await withTenant(tenantId, (tx) => tx.customer.findFirstOrThrow({ where: { isWalkIn: true } }));
    const quotation = await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId,
          type: "QUOTATION",
          number: 999,
          customerId: customer.id,
          subtotal: 10,
          vatTotal: 1.5,
          grandTotal: 11.5,
          lines: {
            create: [
              {
                tenantId,
                productId,
                productName: "Credit Note Product",
                quantity: 1,
                unitPrice: 10,
                discount: 0,
                vatRate: 15,
                lineSubtotal: 10,
                lineVat: 1.5,
                lineTotal: 11.5,
              },
            ],
          },
        } as unknown as Prisma.DocumentUncheckedCreateInput,
        include: { lines: true },
      })
    );
    const response = await POST(
      postRequest({ originalDocumentId: quotation.id, lines: [{ originalLineId: quotation.lines[0].id, quantity: 1 }] })
    );
    expect(response.status).toBe(404);
  });

  it("rejects an empty lines array", { timeout: 20000 }, async () => {
    const receipt = await seedReceipt([2]);
    const response = await POST(postRequest({ originalDocumentId: receipt.id, lines: [] }));
    expect(response.status).toBe(400);
  });
});
