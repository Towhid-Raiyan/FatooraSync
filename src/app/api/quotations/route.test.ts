import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GET, POST } from "./route";

let tenantId: string;
let otherTenantId: string;
let productId: string;
let productWithVatOverrideId: string;
let mockSession: { user: { tenantId: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/quotations", { method: "POST", body: JSON.stringify(body) });
}

function getRequest(query: string) {
  return new Request(`http://localhost/api/quotations${query}`);
}

describe("/api/quotations", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Quotations Test Co", tradeNameEn: "Quotations Test Shop", vatNumber: "300000000000600" },
    });
    tenantId = tenant.id;
    mockSession = { user: { tenantId } };
    await prisma.settings.create({ data: { tenantId, defaultVatRate: 15 } });

    await withTenant(tenantId, (tx) =>
      tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
    );

    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Rice 5kg", unitPrice: 20, quantity: 5 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productId = product.id;

    const productWithVat = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: { nameEn: "Exempt Item", unitPrice: 10, vatRate: 0, quantity: 100 } as Prisma.ProductUncheckedCreateInput,
      })
    );
    productWithVatOverrideId = productWithVat.id;

    const otherTenant = await prisma.tenant.create({
      data: { legalName: "Other Quotations Co", tradeNameEn: "Other Quotations Shop", vatNumber: "300000000000617" },
    });
    otherTenantId = otherTenant.id;
    await prisma.settings.create({ data: { tenantId: otherTenantId, defaultVatRate: 15 } });
  });

  afterAll(async () => {
    await prisma.numberLease.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.documentLine.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("saves a quotation with type QUOTATION, its own numbering, and no ZATCA fields", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "2" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.type).toBe("QUOTATION");
    expect(body.number).toBe(1); // first save against a freshly created tenant -- deterministic
    expect(body.subtotal).toBe("40");
    expect(body.vatTotal).toBe("6");
    expect(body.grandTotal).toBe("46");
    expect(body.invoiceHash).toBeNull();
    expect(body.previousInvoiceHash).toBeNull();
    expect(body.qrCode).toBeNull();
  });

  it("does NOT decrement product stock (unlike a receipt save)", { timeout: 30000 }, async () => {
    const before = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const after = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(after.quantity.toString()).toBe(before.quantity.toString());
  });

  it("falls back to the walk-in customer when the customer draft is empty", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.isWalkIn).toBe(true);
  });

  it("creates a new customer when name and VAT ID are both provided", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "Acme Trading", vatId: "300000000000709" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    expect(response.status).toBe(201);
    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.findFirst({ where: { vatId: "300000000000709" } })
    );
    expect(customer?.name).toBe("Acme Trading");
  });

  it("uses the product's own VAT override instead of the tenant default", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId: productWithVatOverrideId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vatTotal).toBe("0");
  });

  it("returns 400 when no lines are provided", { timeout: 30000 }, async () => {
    const response = await POST(postRequest({ customer: { name: "", vatId: "" }, lines: [] }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when discount exceeds the item's subtotal", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", discount: "999" }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] }));
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId } };
    }
  });

  it("saves with a pre-assigned number when it falls inside an owned lease", { timeout: 30000 }, async () => {
    const leased = await prisma.$transaction(async (txn) => {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextQuotationNumber: { increment: 20 } },
        select: { nextQuotationNumber: true },
      });
      const rangeEnd = tenant.nextQuotationNumber - 1;
      const rangeStart = rangeEnd - 19;
      await txn.numberLease.create({
        data: { tenantId, deviceId: "device-lease-test-q", documentType: "QUOTATION", rangeStart, rangeEnd, nextToIssue: rangeStart },
      });
      return rangeStart;
    });

    const request = new Request("http://localhost/api/quotations", {
      method: "POST",
      headers: { "X-Device-Id": "device-lease-test-q" },
      body: JSON.stringify({
        customer: {},
        lines: [{ productId, quantity: 1 }],
        preAssigned: { number: leased, uuid: "11111111-1111-1111-1111-111111111112" },
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.number).toBe(leased);
  });

  it("rejects a pre-assigned number outside any lease this device owns", { timeout: 30000 }, async () => {
    const request = new Request("http://localhost/api/quotations", {
      method: "POST",
      headers: { "X-Device-Id": "device-with-no-lease-q" },
      body: JSON.stringify({
        customer: {},
        lines: [{ productId, quantity: 1 }],
        preAssigned: { number: 999999, uuid: "22222222-2222-2222-2222-222222222223" },
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
  });

  it("returns the existing document, not a duplicate, on a retried uuid", { timeout: 30000 }, async () => {
    const leased = await prisma.$transaction(async (txn) => {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextQuotationNumber: { increment: 20 } },
        select: { nextQuotationNumber: true },
      });
      const rangeEnd = tenant.nextQuotationNumber - 1;
      const rangeStart = rangeEnd - 19;
      await txn.numberLease.create({
        data: { tenantId, deviceId: "device-retry-test-q", documentType: "QUOTATION", rangeStart, rangeEnd, nextToIssue: rangeStart },
      });
      return rangeStart;
    });
    const body = {
      customer: {},
      lines: [{ productId, quantity: 1 }],
      preAssigned: { number: leased, uuid: "33333333-3333-3333-3333-333333333334" },
    };
    const makeRequest = () =>
      new Request("http://localhost/api/quotations", {
        method: "POST",
        headers: { "X-Device-Id": "device-retry-test-q" },
        body: JSON.stringify(body),
      });

    const first = await POST(makeRequest());
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await POST(makeRequest());
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);
  });

  describe("GET /api/quotations", () => {
    let historyTenantId: string;
    let historyCustomerVatId: string;
    const quotationIds: string[] = [];

    beforeAll(async () => {
      const tenant = await prisma.tenant.create({
        data: { legalName: "Quotation History Co", tradeNameEn: "Quotation History Shop", vatNumber: "300000000000815" },
      });
      historyTenantId = tenant.id;
      mockSession = { user: { tenantId: historyTenantId } };
      await prisma.settings.create({ data: { tenantId: historyTenantId, defaultVatRate: 15 } });
      await withTenant(historyTenantId, (tx) =>
        tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
      );
      const product = await withTenant(historyTenantId, (tx) =>
        tx.product.create({
          data: { nameEn: "History Product", unitPrice: 10, quantity: 1000 } as Prisma.ProductUncheckedCreateInput,
        })
      );
      historyCustomerVatId = "300000000000922";

      // 12 quotations, spaced 1 day apart, newest last -- enough to prove the
      // page-1/page-2 skip/take math (10 + 2) without re-deriving the full
      // pagination test matrix the identical receipt logic already covers.
      for (let i = 0; i < 12; i++) {
        const response = await POST(
          postRequest({
            customer: i === 0 ? { name: "Fresh Customer", vatId: historyCustomerVatId } : { name: "", vatId: "" },
            lines: [{ productId: product.id, quantity: "1" }],
          })
        );
        const saved = await response.json();
        quotationIds.push(saved.id);
        await prisma.document.update({
          where: { id: saved.id },
          data: { createdAt: new Date(Date.UTC(2026, 0, 1 + i, 12, 0, 0)) },
        });
      }
    }, 120000);

    afterAll(() => {
      mockSession = { user: { tenantId } };
    });

    it("returns the 10 newest quotations on page 1, newest first, with the correct total", { timeout: 30000 }, async () => {
      const response = await GET(getRequest("?page=1"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.total).toBe(12);
      expect(body.pageSize).toBe(10);
      expect(body.quotations).toHaveLength(10);
      expect(body.quotations[0].id).toBe(quotationIds[11]);
      expect(body.quotations[9].id).toBe(quotationIds[2]);
    });

    it("returns the remaining 2 quotations on page 2", { timeout: 30000 }, async () => {
      const response = await GET(getRequest("?page=2"));
      const body = await response.json();
      expect(body.quotations).toHaveLength(2);
      expect(body.quotations[0].id).toBe(quotationIds[1]);
      expect(body.quotations[1].id).toBe(quotationIds[0]);
    });

    it("returns an empty page (not an error) for an out-of-range page number", { timeout: 30000 }, async () => {
      const response = await GET(getRequest("?page=99"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.quotations).toEqual([]);
      expect(body.total).toBe(12);
    });

    it("searches by exact quotation number", { timeout: 30000 }, async () => {
      // The first quotation saved in this describe's beforeAll is number 1
      // (a fresh tenant's counter starts at 1).
      const response = await GET(getRequest("?search=1"));
      const body = await response.json();
      expect(body.total).toBe(1);
    });

    it("searches by the QTE-prefixed quotation number, case-insensitively", { timeout: 30000 }, async () => {
      const upper = await GET(getRequest("?search=QTE1"));
      expect((await upper.json()).total).toBe(1);
      const lower = await GET(getRequest("?search=qte1"));
      expect((await lower.json()).total).toBe(1);
    });

    it("numberPrefix narrows live as more digits are typed, unlike search which also fuzzy-matches customer name/VAT", { timeout: 30000 }, async () => {
      // historyCustomerVatId ("300000000000922") contains a "1", so the general
      // `search` param would incidentally match it too via the VAT-contains
      // branch -- `numberPrefix` must not, and must match every number whose
      // decimal form starts with the typed digits (1, 10, 11, 12 for "1"),
      // not just an exact "1".
      const onePrefix = await GET(getRequest("?numberPrefix=1"));
      const oneBody = await onePrefix.json();
      expect(oneBody.total).toBe(4);
      expect(oneBody.quotations.map((q: { number: number }) => q.number).sort((a: number, b: number) => a - b)).toEqual([1, 10, 11, 12]);

      const elevenPrefix = await GET(getRequest("?numberPrefix=11"));
      const elevenBody = await elevenPrefix.json();
      expect(elevenBody.total).toBe(1);
      expect(elevenBody.quotations[0].number).toBe(11);
    });

    it("numberPrefix accepts a QTE prefix, case-insensitively, and returns nothing for an unparsable or empty value", { timeout: 30000 }, async () => {
      const prefixed = await GET(getRequest("?numberPrefix=QTE1"));
      expect((await prefixed.json()).total).toBe(4);
      const lower = await GET(getRequest("?numberPrefix=qte11"));
      expect((await lower.json()).total).toBe(1);
      const garbage = await GET(getRequest("?numberPrefix=not-a-number"));
      expect((await garbage.json()).total).toBe(0);
      const noDigitsYet = await GET(getRequest("?numberPrefix=QTE"));
      expect((await noDigitsYet.json()).total).toBe(0);
    });

    it("searches by the customer's full 15-digit VAT ID without erroring", { timeout: 30000 }, async () => {
      const response = await GET(getRequest(`?search=${historyCustomerVatId}`));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.total).toBe(1);
      expect(body.quotations[0].customerVatId).toBe(historyCustomerVatId);
    });

    it("searches by customer name substring, case-insensitively", { timeout: 30000 }, async () => {
      const response = await GET(getRequest("?search=fresh"));
      const body = await response.json();
      expect(body.total).toBe(1);
    });

    it("filters by an inclusive date range", { timeout: 30000 }, async () => {
      const response = await GET(getRequest("?dateFrom=2026-01-01&dateTo=2026-01-01"));
      const body = await response.json();
      expect(body.total).toBe(1);
    });

    it("never returns another tenant's quotations", { timeout: 30000 }, async () => {
      mockSession = { user: { tenantId } };
      const response = await GET(getRequest("?search=fresh"));
      const body = await response.json();
      expect(body.total).toBe(0);
      mockSession = { user: { tenantId: historyTenantId } };
    });

    it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
      mockSession = null;
      const response = await GET(getRequest("?page=1"));
      expect(response.status).toBe(401);
      mockSession = { user: { tenantId: historyTenantId } };
    });
  });
});
