import { NextResponse } from "next/server";
import { Prisma, type Unit } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { round2, round3, calculateDocumentTotals } from "@/lib/receipts/calculate-totals";
import { withTenant } from "@/lib/db/tenant-context";
import { PAGE_SIZE } from "@/lib/receipts/constants";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { assertCanManageCatalog } from "@/lib/rbac/require-catalog-access";
import { applyStockMovement } from "@/lib/inventory/apply-stock-movement";

const VALID_UNITS: Unit[] = ["PIECE", "KG", "BOX", "CARTON", "LITER", "DOZEN"];

class PurchaseReceiptError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RawLine {
  productId?: unknown;
  unit?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  vatAmount?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const userId = session.user.id;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const catalogBlocked = await assertCanManageCatalog(tenantId, session.user.role);
  if (catalogBlocked) return catalogBlocked;
  const body = await request.json();

  const supplierId = typeof body.supplierId === "string" ? body.supplierId : "";
  if (!supplierId) {
    return NextResponse.json({ error: "Supplier is required" }, { status: 400 });
  }

  const paymentMethod = body.paymentMethod === "CREDIT" ? "CREDIT" : body.paymentMethod === "CASH" ? "CASH" : null;
  if (!paymentMethod) {
    return NextResponse.json({ error: "paymentMethod must be CASH or CREDIT" }, { status: 400 });
  }

  const purchaseDate = new Date(body.purchaseDate);
  if (Number.isNaN(purchaseDate.getTime())) {
    return NextResponse.json({ error: "A valid purchase date is required" }, { status: 400 });
  }

  const supplierReceiptNumber =
    typeof body.supplierReceiptNumber === "string" && body.supplierReceiptNumber.trim()
      ? body.supplierReceiptNumber.trim()
      : null;

  const rawLines: RawLine[] = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "Add at least one product" }, { status: 400 });
  }

  const parsedLines: {
    productId: string;
    unit: Unit;
    quantity: number;
    unitPrice: number;
    vatAmount: number;
  }[] = [];
  for (const line of rawLines) {
    const quantity = Number(line.quantity);
    const unitPrice = round3(Number(line.unitPrice));
    const vatAmount = round2(Number(line.vatAmount));
    if (typeof line.productId !== "string" || !Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Each product must have a positive quantity" }, { status: 400 });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: "Unit price must be zero or more" }, { status: 400 });
    }
    if (!Number.isFinite(vatAmount) || vatAmount < 0) {
      return NextResponse.json({ error: "VAT must be zero or more" }, { status: 400 });
    }
    if (typeof line.unit !== "string" || !VALID_UNITS.includes(line.unit as Unit)) {
      return NextResponse.json({ error: "Each product must have a valid unit" }, { status: 400 });
    }
    parsedLines.push({ productId: line.productId, unit: line.unit as Unit, quantity, unitPrice, vatAmount });
  }

  try {
    const result = await prisma.$transaction(
      async (txn) => {
        const supplier = await txn.supplier.findFirst({ where: { id: supplierId, tenantId } });
        if (!supplier) {
          throw new PurchaseReceiptError("Supplier not found", 404);
        }

        const resolvedLines: {
          productId: string;
          productName: string;
          unit: Unit;
          quantity: number;
          unitPrice: number;
          vatRate: number;
          lineSubtotal: number;
          lineVat: number;
          lineTotal: number;
        }[] = [];

        for (const line of parsedLines) {
          const product = await txn.product.findFirst({
            where: { id: line.productId, tenantId, isActive: true },
          });
          if (!product) {
            throw new PurchaseReceiptError("One or more products are no longer available", 400);
          }
          // Purchase VAT is entered as a direct SAR amount, not a rate (always
          // manual entry, decoupled from the product's own sales vatRate) --
          // lineVat is the entered amount itself, not a percentage calculation.
          // `vatRate` is still derived and stored on the line for the schema
          // column / any future reporting, but nothing reads it as an input.
          const lineSubtotal = round2(line.unitPrice * line.quantity);
          const lineVat = line.vatAmount;
          const lineTotal = round2(lineSubtotal + lineVat);
          const vatRate = lineSubtotal > 0 ? round2((lineVat / lineSubtotal) * 100) : 0;
          resolvedLines.push({
            productId: product.id,
            productName: product.nameEn,
            unit: line.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            vatRate,
            lineSubtotal,
            lineVat,
            lineTotal,
          });
        }

        const { subtotal, vatTotal, grandTotal } = calculateDocumentTotals(resolvedLines);

        const tenantCounters = await txn.tenant.update({
          where: { id: tenantId },
          data: { nextPurchaseReceiptNumber: { increment: 1 } },
          select: { nextPurchaseReceiptNumber: true },
        });
        const number = tenantCounters.nextPurchaseReceiptNumber - 1;

        const created = await txn.purchaseReceipt.create({
          data: {
            tenantId,
            number,
            supplierReceiptNumber,
            supplierId,
            purchaseDate,
            paymentMethod,
            subtotal,
            vatTotal,
            grandTotal,
            lines: {
              create: resolvedLines.map((line) => ({
                tenantId,
                productId: line.productId,
                productName: line.productName,
                unit: line.unit,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                vatRate: line.vatRate,
                lineSubtotal: line.lineSubtotal,
                lineVat: line.lineVat,
                lineTotal: line.lineTotal,
              })),
            },
          } as Prisma.PurchaseReceiptUncheckedCreateInput,
          include: { lines: true, supplier: true },
        });

        const movements = [];
        for (const line of resolvedLines) {
          const { movement } = await applyStockMovement(txn, {
            tenantId,
            productId: line.productId,
            type: "RESTOCK",
            quantityDelta: line.quantity,
            createdByUserId: userId,
            unitCost: line.unitPrice,
            supplierId,
            purchaseReceiptId: created.id,
          });
          const withRelations = await txn.stockMovement.findUniqueOrThrow({
            where: { id: movement.id },
            include: {
              product: { select: { nameEn: true, nameAr: true, sku: true } },
              supplier: { select: { name: true } },
              createdByUser: { select: { email: true } },
              purchaseReceipt: { select: { number: true } },
            },
          });
          movements.push(withRelations);
        }

        return { purchaseReceipt: created, movements };
      },
      { timeout: 20000, maxWait: 5000 }
    );

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PurchaseReceiptError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

function parseDateOrNull(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const pageParam = Number(url.searchParams.get("page"));
  const page =
    Number.isFinite(pageParam) && pageParam >= 1 ? Math.min(Math.floor(pageParam), 1_000_000) : 1;

  const search = url.searchParams.get("search")?.trim() || "";
  const startOfDay = parseDateOrNull(url.searchParams.get("dateFrom"));
  const endOfDay = parseDateOrNull(url.searchParams.get("dateTo"));
  if (endOfDay) {
    endOfDay.setUTCHours(23, 59, 59, 999);
  }

  // `tenantId` is deliberately absent from this `where` -- withTenant() injects it.
  const where: Prisma.PurchaseReceiptWhereInput = {};
  if (startOfDay || endOfDay) {
    where.purchaseDate = {
      ...(startOfDay ? { gte: startOfDay } : {}),
      ...(endOfDay ? { lte: endOfDay } : {}),
    };
  }
  if (search) {
    const strippedHash = search.startsWith("#") ? search.slice(1) : search;
    const parsed = /^\d+$/.test(strippedHash) ? Number(strippedHash) : null;
    const parsedNumber = parsed !== null && parsed <= 2147483647 ? parsed : null;
    where.OR = [
      ...(parsedNumber !== null ? [{ number: parsedNumber }] : []),
      { supplierReceiptNumber: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [total, purchaseReceipts] = await withTenant(tenantId, (txn) =>
    Promise.all([
      txn.purchaseReceipt.count({ where }),
      txn.purchaseReceipt.findMany({
        where,
        orderBy: { purchaseDate: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          number: true,
          supplierReceiptNumber: true,
          purchaseDate: true,
          paymentMethod: true,
          grandTotal: true,
          supplier: { select: { name: true } },
        },
      }),
    ])
  );

  const receipts = purchaseReceipts.map((pr) => ({
    id: pr.id,
    number: pr.number,
    supplierReceiptNumber: pr.supplierReceiptNumber,
    supplierName: pr.supplier.name,
    purchaseDate: pr.purchaseDate.toISOString(),
    paymentMethod: pr.paymentMethod,
    grandTotal: pr.grandTotal.toString(),
  }));

  return NextResponse.json({ receipts, total, page, pageSize: PAGE_SIZE });
}
