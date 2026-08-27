import type { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/db/client";

// Atomically reserves the next `blockSize` numbers for one device, so it can
// issue final invoice/quotation numbers offline with zero further server
// contact. Uses the *same* Tenant.next*Number counters the online save path
// already increments one at a time (src/app/api/receipts/route.ts,
// src/app/api/quotations/route.ts) -- leasing a block of 20 is equivalent to
// 20 sequential single-number reservations, just claimed up front.
//
// The counter field is branched on rather than accessed via a computed
// `[field]` key: Prisma's generated `update`/`select` types don't infer
// correctly against a union-typed dynamic key (it resolves to an unrelated
// model's shape under `--strict`), so keeping each branch's `data`/`select`
// literal is what keeps this type-checking cleanly.
export async function leaseNumberBlock(
  tenantId: string,
  deviceId: string,
  documentType: DocumentType,
  blockSize: number
): Promise<{ rangeStart: number; rangeEnd: number }> {
  return prisma.$transaction(async (txn) => {
    let nextAfter: number;
    if (documentType === "SALES_RECEIPT") {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextSalesReceiptNumber: { increment: blockSize } },
        select: { nextSalesReceiptNumber: true },
      });
      nextAfter = tenant.nextSalesReceiptNumber;
    } else {
      const tenant = await txn.tenant.update({
        where: { id: tenantId },
        data: { nextQuotationNumber: { increment: blockSize } },
        select: { nextQuotationNumber: true },
      });
      nextAfter = tenant.nextQuotationNumber;
    }
    const rangeStart = nextAfter - blockSize;
    const rangeEnd = nextAfter - 1;

    await txn.numberLease.create({
      data: { tenantId, deviceId, documentType, rangeStart, rangeEnd, nextToIssue: rangeStart },
    });

    return { rangeStart, rangeEnd };
  });
}
