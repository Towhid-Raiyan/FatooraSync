import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { GENESIS_HASH } from "@/lib/zatca/hash-chain";
import { GET, POST } from "./route";

let tenantId: string;
let otherTenantId: string;
let productId: string;
let productWithVatOverrideId: string;
let otherTenantProductId: string;
let userId: string;
let otherUserId: string;
let mockSession: { user: { tenantId: string; id: string } } | null = null;

vi.mock("@/lib/auth/config", () => ({
  auth: async () => mockSession,
}));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/receipts", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/receipts", () => {
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { legalName: "Receipts Test Co", tradeNameEn: "Receipts Test Shop", vatNumber: "300000000000105" },
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `receipts-route-test+${Date.now()}@example.com`, passwordHash: "test-hash" },
    });
    userId = user.id;
    mockSession = { user: { tenantId, id: userId } };
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
      data: { legalName: "Other Receipts Co", tradeNameEn: "Other Receipts Shop", vatNumber: "300000000000112" },
    });
    otherTenantId = otherTenant.id;
    const otherUser = await prisma.user.create({
      data: { tenantId: otherTenantId, email: `receipts-route-test-other+${Date.now()}@example.com`, passwordHash: "test-hash" },
    });
    otherUserId = otherUser.id;
    await prisma.settings.create({ data: { tenantId: otherTenantId, defaultVatRate: 15 } });
    const otherProduct = await withTenant(otherTenantId, (tx) =>
      tx.product.create({ data: { nameEn: "Other Tenant Product", unitPrice: 1, quantity: 10 } as Prisma.ProductUncheckedCreateInput })
    );
    otherTenantProductId = otherProduct.id;
  });

  afterAll(async () => {
    await prisma.numberLease.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.stockMovement.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.documentLine.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.document.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.settings.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.$disconnect();
  });

  it("falls back to the walk-in customer when the customer draft is empty", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "2" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    // First save against a freshly created tenant in beforeAll -- deterministically number 1.
    expect(body.number).toBe(1);
    expect(body.previousInvoiceHash).toBe(GENESIS_HASH);
    expect(body.subtotal).toBe("40");
    expect(body.vatTotal).toBe("6");
    expect(body.grandTotal).toBe("46");
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].productName).toBe("Rice 5kg");

    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.isWalkIn).toBe(true);

    const product = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(product.quantity.toString()).toBe("3"); // 5 - 2
  });

  it("falls back to the walk-in customer when only the name is provided", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "Partial Only", vatId: "" }, lines: [{ productId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.isWalkIn).toBe(true);

    const named = await withTenant(tenantId, (tx) => tx.customer.findFirst({ where: { name: "Partial Only" } }));
    expect(named).toBeNull();
  });

  it("falls back to the walk-in customer when only the VAT ID is provided", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "399999999900003" }, lines: [{ productId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.isWalkIn).toBe(true);

    const byVatId = await withTenant(tenantId, (tx) =>
      tx.customer.findFirst({ where: { vatId: "399999999900003" } })
    );
    expect(byVatId).toBeNull();
  });

  it("uses the product's own VAT override instead of the tenant default", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId: productWithVatOverrideId, quantity: "1" }] })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vatTotal).toBe("0");
  });

  it("still ignores a client-supplied vatRate/productName and uses the server's own product read", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [
          {
            productId,
            quantity: "1",
            vatRate: "0",
            productName: "Forged Line Item",
          },
        ],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines[0].unitPrice).toBe("20");
    expect(body.lines[0].productName).toBe("Rice 5kg");
    expect(body.grandTotal).toBe("23"); // 20 * 1.15 (catalog price + real VAT), not the forged values
  });

  it("honors a client-supplied unitPrice override for a manual price at the point of sale", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", unitPrice: "18" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines[0].unitPrice).toBe("18");
    expect(body.grandTotal).toBe("20.7"); // 18 * 1.15, not the catalog price of 20
  });

  it("returns 400 for a negative unitPrice override", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", unitPrice: "-5" }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("treats an empty-string unitPrice as an explicit zero override, not a fallback to the catalog price", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", unitPrice: "" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines[0].unitPrice).toBe("0");
    expect(body.grandTotal).toBe("0");
  });

  it("falls back to the catalog price when unitPrice is explicitly null", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", unitPrice: null }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines[0].unitPrice).toBe("20");
  });

  it("honors a client-supplied lineTotal override exactly, even for a total that has no exact unit-price representation", { timeout: 30000 }, async () => {
    // 3 units at 15% VAT targeting 12.00: no unit price at any precision
    // forward-computes through calculateLine to exactly 12.00 (the reachable
    // totals nearby are 11.99 and 12.01) -- this is the client-reported bug.
    // calculateLineFromTotal, used when lineTotal is present, anchors on the
    // typed total directly instead of trying to reverse-engineer a unit price.
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "3", lineTotal: "12" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines[0].lineSubtotal).toBe("10.43");
    expect(body.lines[0].lineVat).toBe("1.57");
    expect(body.lines[0].lineTotal).toBe("12");
    expect(body.grandTotal).toBe("12");
  });

  it("returns 400 for a negative lineTotal override", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", lineTotal: "-5" }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("prioritizes lineTotal over unitPrice when both are present in the request", { timeout: 30000 }, async () => {
    // The client always sends both -- unitPrice as the (purely informational)
    // derived display price, lineTotal as the pinned truth -- but the server
    // must trust lineTotal, not silently fall back to the stale unitPrice.
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "3", unitPrice: "999", lineTotal: "12" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines[0].lineTotal).toBe("12");
  });

  it("does not apply the discount-exceeds-subtotal check to a lineTotal-anchored line", { timeout: 30000 }, async () => {
    // In unit-price mode a discount this large relative to the price would be
    // rejected (see the two tests below), but a lineTotal-anchored line has no
    // raw pre-discount subtotal to compare against -- the total is fixed
    // regardless of discount, which only affects the derived, informational
    // unit price.
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", lineTotal: "12", discount: "999" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lines[0].lineTotal).toBe("12");
  });

  it("checks discount against the overridden price, not the catalog price -- rejecting when the override makes it too small", { timeout: 30000 }, async () => {
    // catalog price is 20 (would allow a discount of 10), but the override drops
    // the effective subtotal to 5, which a 10 discount now exceeds
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", unitPrice: "5", discount: "10" }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("checks discount against the overridden price, not the catalog price -- allowing when the override makes it large enough", { timeout: 30000 }, async () => {
    // catalog price is 20 (would reject a discount of 30), but the override raises
    // the effective subtotal to 50, which comfortably covers a 30 discount
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", unitPrice: "50", discount: "30" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.subtotal).toBe("20"); // 50 - 30
  });

  it("assigns sequential receipt numbers and chains the hash", { timeout: 30000 }, async () => {
    const first = await POST(postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] }));
    const second = await POST(postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] }));
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.number).toBe(firstBody.number + 1);
    expect(secondBody.previousInvoiceHash).toBe(firstBody.invoiceHash);
  });

  it("creates a new customer when both name and VAT ID are provided", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "Fresh Customer", vatId: "300000000000200", phone: "0500000000" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.name).toBe("Fresh Customer");
    expect(customer?.vatId).toBe("300000000000200");
  });

  it("reuses an existing customer matched by VAT ID instead of creating a duplicate", { timeout: 30000 }, async () => {
    const first = await POST(
      postRequest({
        customer: { name: "Reused Co", vatId: "300000000000217" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    const firstBody = await first.json();

    // Typed with a different name but the same VAT ID -- the stored record should win.
    const second = await POST(
      postRequest({
        customer: { name: "Typo'd Name", vatId: "300000000000217" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    const secondBody = await second.json();

    expect(secondBody.customerId).toBe(firstBody.customerId);
    const customer = await withTenant(tenantId, (tx) =>
      tx.customer.findUnique({ where: { id: firstBody.customerId } })
    );
    expect(customer?.name).toBe("Reused Co");
  });

  it("never matches a customer with the same VAT ID under a different tenant", { timeout: 30000 }, async () => {
    await withTenant(otherTenantId, (tx) =>
      tx.customer.create({
        data: { name: "Other Tenant's Customer", vatId: "300000000000224" } as Prisma.CustomerUncheckedCreateInput,
      })
    );

    const response = await POST(
      postRequest({
        customer: { name: "Same VAT, This Tenant", vatId: "300000000000224" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    const customer = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: body.customerId } }));
    expect(customer?.tenantId).toBe(tenantId);
    expect(customer?.name).toBe("Same VAT, This Tenant");
  });

  it("reactivates a deactivated customer matched by VAT ID instead of failing on the unique constraint", { timeout: 30000 }, async () => {
    const deactivated = await withTenant(tenantId, (tx) =>
      tx.customer.create({
        data: {
          name: "Deactivated Co",
          vatId: "300000000000231",
          isActive: false,
        } as Prisma.CustomerUncheckedCreateInput,
      })
    );

    const response = await POST(
      postRequest({
        customer: { name: "Deactivated Co", vatId: "300000000000231" },
        lines: [{ productId, quantity: "1" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.customerId).toBe(deactivated.id);

    const reactivated = await withTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id: deactivated.id } }));
    expect(reactivated?.isActive).toBe(true);
  });

  it("lazily creates the walk-in customer for a tenant that doesn't have one yet, rather than failing the save", { timeout: 30000 }, async () => {
    // `otherTenantId` was deliberately never given a walk-in customer in beforeAll
    // -- this reproduces a tenant that, for whatever reason, ended up without one
    // (e.g. a provisioning path that didn't call seed-tenant.ts), which used to
    // hard-fail every no-customer-info save for that tenant.
    const before = await withTenant(otherTenantId, (tx) =>
      tx.customer.findFirst({ where: { isWalkIn: true } })
    );
    expect(before).toBeNull();

    mockSession = { user: { tenantId: otherTenantId, id: otherUserId } };
    try {
      const response = await POST(
        postRequest({
          customer: { name: "", vatId: "" },
          lines: [{ productId: otherTenantProductId, quantity: "1" }],
        })
      );
      expect(response.status).toBe(201);
      const body = await response.json();

      const walkIn = await withTenant(otherTenantId, (tx) =>
        tx.customer.findFirst({ where: { isWalkIn: true } })
      );
      expect(walkIn).not.toBeNull();
      expect(walkIn?.name).toBe("Walk-in Customer");
      expect(body.customerId).toBe(walkIn?.id);
    } finally {
      mockSession = { user: { tenantId, id: userId } };
    }
  });

  it("applies a flat discount before VAT and reflects it in the saved line and totals", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "2", discount: "10" }],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    // raw subtotal 40, discount 10 -> 30, vat 15% = 4.5, total 34.5
    expect(body.lines[0].discount).toBe("10");
    expect(body.subtotal).toBe("30");
    expect(body.vatTotal).toBe("4.5");
    expect(body.grandTotal).toBe("34.5");
  });

  it("returns 400 when a line's discount exceeds its subtotal", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", discount: "999" }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a negative discount", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({
        customer: { name: "", vatId: "" },
        lines: [{ productId, quantity: "1", discount: "-5" }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("allows stock to go negative without blocking the save", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "999" }] })
    );
    expect(response.status).toBe(201);
    const product = await withTenant(tenantId, (tx) => tx.product.findUniqueOrThrow({ where: { id: productId } }));
    expect(Number(product.quantity)).toBeLessThan(0);
  });

  it("returns 400 for an empty line list", { timeout: 30000 }, async () => {
    const response = await POST(postRequest({ customer: { name: "", vatId: "" }, lines: [] }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-positive quantity", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "0" }] })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a productId belonging to another tenant", { timeout: 30000 }, async () => {
    const response = await POST(
      postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId: otherTenantProductId, quantity: "1" }] })
    );
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
    mockSession = null;
    try {
      const response = await POST(
        postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] })
      );
      expect(response.status).toBe(401);
    } finally {
      mockSession = { user: { tenantId, id: userId } };
    }
  });

  it("returns 403 for a SUSPENDED tenant instead of saving the receipt", { timeout: 30000 }, async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { billingStatus: "SUSPENDED" } });
    try {
      const response = await POST(
        postRequest({ customer: { name: "", vatId: "" }, lines: [{ productId, quantity: "1" }] })
      );
      expect(response.status).toBe(403);
    } finally {
      await prisma.tenant.update({ where: { id: tenantId }, data: { billingStatus: "TRIALING" } });
    }
  });

  it("saves with a pre-assigned number when it falls inside an owned lease", { timeout: 30000 }, async () => {
    const leased = await prisma.$transaction(async (txn) => {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: 20 } },
        select: { nextSalesReceiptNumber: true },
      });
      const rangeEnd = tenant.nextSalesReceiptNumber - 1;
      const rangeStart = rangeEnd - 19;
      await txn.numberLease.create({
        data: { tenantId, deviceId: "device-lease-test", documentType: "SALES_RECEIPT", rangeStart, rangeEnd, nextToIssue: rangeStart },
      });
      return rangeStart;
    });

    const request = new Request("http://localhost/api/receipts", {
      method: "POST",
      headers: { "X-Device-Id": "device-lease-test" },
      body: JSON.stringify({
        customer: {},
        lines: [{ productId, quantity: 1 }],
        preAssigned: { number: leased, uuid: "11111111-1111-1111-1111-111111111111" },
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.number).toBe(leased);
  });

  it("rejects a pre-assigned number outside any lease this device owns", { timeout: 30000 }, async () => {
    const request = new Request("http://localhost/api/receipts", {
      method: "POST",
      headers: { "X-Device-Id": "device-with-no-lease" },
      body: JSON.stringify({
        customer: {},
        lines: [{ productId, quantity: 1 }],
        preAssigned: { number: 999999, uuid: "22222222-2222-2222-2222-222222222222" },
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(409);
  });

  it("returns the existing document, not a duplicate, on a retried uuid", { timeout: 30000 }, async () => {
    const leased = await prisma.$transaction(async (txn) => {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: 20 } },
        select: { nextSalesReceiptNumber: true },
      });
      const rangeEnd = tenant.nextSalesReceiptNumber - 1;
      const rangeStart = rangeEnd - 19;
      await txn.numberLease.create({
        data: { tenantId, deviceId: "device-retry-test", documentType: "SALES_RECEIPT", rangeStart, rangeEnd, nextToIssue: rangeStart },
      });
      return rangeStart;
    });
    const body = {
      customer: {},
      lines: [{ productId, quantity: 1 }],
      preAssigned: { number: leased, uuid: "33333333-3333-3333-3333-333333333333" },
    };
    const makeRequest = () =>
      new Request("http://localhost/api/receipts", {
        method: "POST",
        headers: { "X-Device-Id": "device-retry-test" },
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

  it("stores an offline sale's original createdAt, not the sync time", { timeout: 30000 }, async () => {
    const leased = await prisma.$transaction(async (txn) => {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: 20 } },
        select: { nextSalesReceiptNumber: true },
      });
      const rangeEnd = tenant.nextSalesReceiptNumber - 1;
      const rangeStart = rangeEnd - 19;
      await txn.numberLease.create({
        data: { tenantId, deviceId: "device-createdat-test", documentType: "SALES_RECEIPT", rangeStart, rangeEnd, nextToIssue: rangeStart },
      });
      return rangeStart;
    });

    const offlineCreatedAt = "2026-08-20T09:15:30.000Z";
    const request = new Request("http://localhost/api/receipts", {
      method: "POST",
      headers: { "X-Device-Id": "device-createdat-test" },
      body: JSON.stringify({
        customer: {},
        lines: [{ productId, quantity: 1 }],
        createdAt: offlineCreatedAt,
        preAssigned: { number: leased, uuid: "44444444-4444-4444-4444-444444444444" },
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(new Date(body.createdAt).toISOString()).toBe(offlineCreatedAt);

    // The QR and the hash chain both bake in the timestamp -- the whole point
    // of honoring it is that the stored record matches the copy the cashier
    // already printed offline, so verify the persisted row too, not just the
    // response.
    const stored = await withTenant(tenantId, (tx) => tx.document.findFirstOrThrow({ where: { uuid: "44444444-4444-4444-4444-444444444444" } }));
    expect(stored.createdAt.toISOString()).toBe(offlineCreatedAt);
  });

  it("falls back to now for a future-dated or unparsable createdAt", { timeout: 30000 }, async () => {
    const leased = await prisma.$transaction(async (txn) => {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: 20 } },
        select: { nextSalesReceiptNumber: true },
      });
      const rangeEnd = tenant.nextSalesReceiptNumber - 1;
      const rangeStart = rangeEnd - 19;
      await txn.numberLease.create({
        data: { tenantId, deviceId: "device-badclock-test", documentType: "SALES_RECEIPT", rangeStart, rangeEnd, nextToIssue: rangeStart },
      });
      return rangeStart;
    });

    const save = async (createdAt: unknown, number: number, uuid: string) => {
      const before = Date.now();
      const response = await POST(
        new Request("http://localhost/api/receipts", {
          method: "POST",
          headers: { "X-Device-Id": "device-badclock-test" },
          body: JSON.stringify({
            customer: {},
            lines: [{ productId, quantity: 1 }],
            createdAt,
            preAssigned: { number, uuid },
          }),
        })
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      const stored = new Date(body.createdAt).getTime();
      // Roughly "now" -- bounded by the wall clock either side of the call,
      // with a second of slack for the DB round trip's own timestamp rounding.
      expect(stored).toBeGreaterThanOrEqual(before - 1000);
      expect(stored).toBeLessThanOrEqual(Date.now() + 1000);
    };

    // A device whose clock is a year fast must not backdate-forward the tax record.
    await save("2027-08-20T09:15:30.000Z", leased, "55555555-5555-5555-5555-555555555555");
    // Garbage in the field must not throw, and must not store an Invalid Date.
    await save("not-a-date", leased + 1, "66666666-6666-6666-6666-666666666666");
  });

  describe("GET /api/receipts", () => {
    let historyTenantId: string;
    let historyProductId: string;
    let historyUserId: string;
    const createdReceiptIds: string[] = [];

    beforeAll(async () => {
      const tenant = await prisma.tenant.create({
        data: { legalName: "History Test Co", tradeNameEn: "History Test Shop", vatNumber: "300000000000440" },
      });
      historyTenantId = tenant.id;
      await prisma.settings.create({ data: { tenantId: historyTenantId, defaultVatRate: 15 } });
      await withTenant(historyTenantId, (tx) =>
        tx.customer.create({ data: { name: "Walk-in Customer", isWalkIn: true } as Prisma.CustomerUncheckedCreateInput })
      );
      await withTenant(historyTenantId, (tx) =>
        tx.customer.create({
          data: { name: "History Customer", vatId: "300000000000457" } as Prisma.CustomerUncheckedCreateInput,
        })
      );
      const product = await withTenant(historyTenantId, (tx) =>
        tx.product.create({
          data: { nameEn: "History Product", unitPrice: 10, quantity: 1000 } as Prisma.ProductUncheckedCreateInput,
        })
      );
      historyProductId = product.id;

      const historyUser = await prisma.user.create({
        data: { tenantId: historyTenantId, email: `receipts-route-history+${Date.now()}@example.com`, passwordHash: "test-hash" },
      });
      historyUserId = historyUser.id;

      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      // 15 receipts for historyCustomerId, backdated one day apart, oldest first
      for (let i = 0; i < 15; i++) {
        const res = await POST(
          postRequest({
            customer: { name: "History Customer", vatId: "300000000000457" },
            lines: [{ productId: historyProductId, quantity: "1" }],
          })
        );
        const body = await res.json();
        createdReceiptIds.push(body.id);
        const backdated = new Date(Date.now() - (15 - i) * 24 * 60 * 60 * 1000);
        await prisma.document.update({ where: { id: body.id }, data: { createdAt: backdated } });
      }
      mockSession = { user: { tenantId, id: userId } };
    }, 120000);

    afterAll(async () => {
      await prisma.stockMovement.deleteMany({ where: { tenantId: historyTenantId } });
      await prisma.documentLine.deleteMany({ where: { tenantId: historyTenantId } });
      await prisma.document.deleteMany({ where: { tenantId: historyTenantId } });
      await prisma.customer.deleteMany({ where: { tenantId: historyTenantId } });
      await prisma.product.deleteMany({ where: { tenantId: historyTenantId } });
      await prisma.user.deleteMany({ where: { tenantId: historyTenantId } });
      await prisma.settings.deleteMany({ where: { tenantId: historyTenantId } });
      await prisma.tenant.delete({ where: { id: historyTenantId } });
    });

    function historyRequest(query: string) {
      return new Request(`http://localhost/api/receipts${query}`);
    }

    it("returns the first page (10 rows) newest-first, with the true total", { timeout: 30000 }, async () => {
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const response = await GET(historyRequest(""));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.receipts).toHaveLength(10);
        expect(body.total).toBe(15);
        expect(body.page).toBe(1);
        expect(body.pageSize).toBe(10);
        // newest-first: the last-created receipt (index 14, most recently backdated) leads
        expect(body.receipts[0].id).toBe(createdReceiptIds[14]);
        expect(body.receipts[9].id).toBe(createdReceiptIds[5]);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("returns the second page with the remaining rows", { timeout: 30000 }, async () => {
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const response = await GET(historyRequest("?page=2"));
        const body = await response.json();
        expect(body.receipts).toHaveLength(5);
        expect(body.total).toBe(15);
        expect(body.receipts[4].id).toBe(createdReceiptIds[0]);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("returns an empty page (not an error) for a page number past the end", { timeout: 30000 }, async () => {
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const response = await GET(historyRequest("?page=99"));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.receipts).toEqual([]);
        expect(body.total).toBe(15);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("returns an empty page (not a 500) for an absurdly large page number that would overflow skip", { timeout: 30000 }, async () => {
      // An unclamped page number flows into `skip = (page - 1) * PAGE_SIZE`,
      // which Prisma rejects outside its safe integer range (a 64-bit signed
      // int, ~9.2e18) -- this must clamp to the same "out-of-range page"
      // behavior as a merely-too-large page. The page value here (1e18) is
      // chosen so that (page - 1) * PAGE_SIZE genuinely exceeds that 64-bit
      // limit pre-fix; a smaller value like 999999999999 does not actually
      // overflow `skip` and would let this test pass even without the clamp.
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const response = await GET(historyRequest("?page=1000000000000000000"));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.receipts).toEqual([]);
        expect(body.total).toBe(15);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("searches by exact receipt number", { timeout: 30000 }, async () => {
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const first = await GET(historyRequest(""));
        const firstBody = await first.json();
        const targetNumber = firstBody.receipts[0].number;
        const response = await GET(historyRequest(`?search=${targetNumber}`));
        const body = await response.json();
        expect(body.receipts.every((r: { number: number }) => r.number === targetNumber)).toBe(true);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("searches by customer name substring, case-insensitively", { timeout: 30000 }, async () => {
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const response = await GET(historyRequest("?search=history cust"));
        const body = await response.json();
        expect(body.total).toBe(15);
        expect(body.receipts.every((r: { customerName: string }) => r.customerName === "History Customer")).toBe(true);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("searches by VAT ID substring", { timeout: 30000 }, async () => {
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const response = await GET(historyRequest("?search=000457"));
        const body = await response.json();
        expect(body.total).toBe(15);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("searches by a full 15-digit VAT ID without a 500 from the INT4 overflow on Document.number", { timeout: 30000 }, async () => {
      // A full Saudi VAT ID is always 15 digits, which is also all-digits and
      // therefore matches the same regex used to detect a receipt-number search.
      // 300000000000457 exceeds Postgres INT4's max (2,147,483,647), so an
      // unclamped parse would be handed to Prisma as an exact `number` filter and
      // throw -- this must fall through to the vatId `contains` match instead.
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const response = await GET(historyRequest("?search=300000000000457"));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.total).toBe(15);
        expect(body.receipts).toHaveLength(10);
        expect(
          body.receipts.every((r: { customerVatId: string }) => r.customerVatId === "300000000000457")
        ).toBe(true);
        expect(body.receipts.every((r: { grandTotal: string }) => r.grandTotal === "11.5")).toBe(true);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("returns an empty result for a search matching neither a number nor any customer", { timeout: 30000 }, async () => {
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const response = await GET(historyRequest("?search=zzz-no-match-zzz"));
        const body = await response.json();
        expect(body.total).toBe(0);
        expect(body.receipts).toEqual([]);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("filters by date range inclusively, excluding just outside either end", { timeout: 30000 }, async () => {
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        // receipt index 10 was backdated to (today - 5 days); index 9 to (today - 6 days)
        const targetDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const response = await GET(historyRequest(`?dateFrom=${targetDate}&dateTo=${targetDate}`));
        const body = await response.json();
        expect(body.total).toBe(1);
        expect(body.receipts[0].id).toBe(createdReceiptIds[10]);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("never returns another tenant's receipts, even when a search term matches their customer", { timeout: 30000 }, async () => {
      // tenantId's own beforeAll created a "Fresh Customer" earlier in this file;
      // searching for it while scoped to historyTenantId must find nothing
      mockSession = { user: { tenantId: historyTenantId, id: historyUserId } };
      try {
        const response = await GET(historyRequest("?search=Fresh Customer"));
        const body = await response.json();
        expect(body.total).toBe(0);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });

    it("returns 401 when unauthenticated", { timeout: 30000 }, async () => {
      mockSession = null;
      try {
        const response = await GET(historyRequest(""));
        expect(response.status).toBe(401);
      } finally {
        mockSession = { user: { tenantId, id: userId } };
      }
    });
  });
});
