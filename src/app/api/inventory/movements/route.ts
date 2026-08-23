import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { assertCanManageCatalog } from "@/lib/rbac/require-catalog-access";
import { applyStockMovement } from "@/lib/inventory/apply-stock-movement";

const ADJUSTMENT_REASONS = new Set(["DAMAGE", "LOSS_THEFT", "RECOUNT", "OTHER"]);

// Viewing history is available to any signed-in tenant user (same visibility
// as the Products list) -- only the write side (POST) is gated by the
// catalog-management permission.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const type = url.searchParams.get("type");

  const where: { productId?: string; type?: "SALE" | "RESTOCK" | "ADJUSTMENT" } = {};
  if (productId) where.productId = productId;
  if (type === "SALE" || type === "RESTOCK" || type === "ADJUSTMENT") where.type = type;

  const movements = await withTenant(tenantId, (tx) =>
    tx.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        product: { select: { nameEn: true, nameAr: true, sku: true } },
        supplier: { select: { name: true } },
        createdByUser: { select: { email: true } },
        purchaseReceipt: { select: { number: true } },
      },
    })
  );
  return NextResponse.json(movements);
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

  const type = body.type;
  if (type !== "RESTOCK" && type !== "ADJUSTMENT") {
    return NextResponse.json({ error: "type must be RESTOCK or ADJUSTMENT" }, { status: 400 });
  }

  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity === 0) {
    return NextResponse.json({ error: "quantity must be a non-zero number" }, { status: 400 });
  }

  let reason: string | undefined;
  const note: string | null = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  let unitCost: number | null = null;
  let supplierId: string | null = null;
  let quantityDelta = quantity;

  if (type === "RESTOCK") {
    if (quantity <= 0) {
      return NextResponse.json({ error: "Restock quantity must be positive" }, { status: 400 });
    }
    quantityDelta = quantity;
    if (body.unitCost !== undefined && body.unitCost !== null && body.unitCost !== "") {
      const parsedCost = Number(body.unitCost);
      if (!Number.isFinite(parsedCost) || parsedCost < 0) {
        return NextResponse.json({ error: "unitCost must be zero or more" }, { status: 400 });
      }
      unitCost = parsedCost;
    }
    if (typeof body.supplierId === "string" && body.supplierId) {
      supplierId = body.supplierId;
    }
  } else {
    if (!ADJUSTMENT_REASONS.has(body.reason)) {
      return NextResponse.json(
        { error: "reason must be one of DAMAGE, LOSS_THEFT, RECOUNT, OTHER" },
        { status: 400 }
      );
    }
    reason = body.reason;
    if (reason === "OTHER" && !note) {
      return NextResponse.json({ error: "A note is required when the reason is Other" }, { status: 400 });
    }
    quantityDelta = quantity; // adjustments carry their own sign, either direction
  }

  const product = await withTenant(tenantId, (tx) =>
    tx.product.findFirst({ where: { id: productId, isActive: true } })
  );
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (supplierId) {
    const supplier = await withTenant(tenantId, (tx) => tx.supplier.findFirst({ where: { id: supplierId! } }));
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }
  }

  const { movement } = await prisma.$transaction((txn) =>
    applyStockMovement(txn, {
      tenantId,
      productId,
      type,
      quantityDelta,
      createdByUserId: userId,
      reason: reason as "DAMAGE" | "LOSS_THEFT" | "RECOUNT" | "OTHER" | undefined,
      note,
      unitCost,
      supplierId,
    })
  );

  // Re-read with the same relational shape GET uses, so the caller's optimistic
  // UI update doesn't need a page reload to show who/what it's attached to.
  const withRelations = await withTenant(tenantId, (tx) =>
    tx.stockMovement.findUniqueOrThrow({
      where: { id: movement.id },
      include: {
        product: { select: { nameEn: true, nameAr: true, sku: true } },
        supplier: { select: { name: true } },
        createdByUser: { select: { email: true } },
        purchaseReceipt: { select: { number: true } },
      },
    })
  );

  return NextResponse.json(withRelations, { status: 201 });
}
