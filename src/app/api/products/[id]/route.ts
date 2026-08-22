import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { Unit } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { findBarcodeConflict } from "../check-uniqueness";
import { assertTenantAccess } from "@/lib/billing/require-tenant-access";
import { assertCanManageCatalog } from "@/lib/rbac/require-catalog-access";

const VALID_UNITS: Unit[] = ["PIECE", "KG", "BOX", "CARTON", "LITER"];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const blocked = await assertTenantAccess(tenantId);
  if (blocked) return blocked;
  const catalogBlocked = await assertCanManageCatalog(tenantId, session.user.role);
  if (catalogBlocked) return catalogBlocked;
  const { id } = await params;
  const body = await request.json();

  const existing = await withTenant(tenantId, (tx) => tx.product.findUnique({ where: { id } }));
  if (!existing) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (body.nameEn !== undefined) {
    const nameEn = typeof body.nameEn === "string" ? body.nameEn.trim() : "";
    if (!nameEn) {
      return NextResponse.json({ error: "English name is required" }, { status: 400 });
    }
    data.nameEn = nameEn;
  }
  if (body.nameAr !== undefined) data.nameAr = body.nameAr || null;

  if (body.unitPrice !== undefined) {
    const unitPrice = Number(body.unitPrice);
    if (body.unitPrice === "" || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: "Unit price is required and must be zero or more" }, { status: 400 });
    }
    data.unitPrice = unitPrice;
  }

  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity);
    if (body.quantity === "" || !Number.isFinite(quantity) || quantity < 0) {
      return NextResponse.json({ error: "Quantity must be zero or more" }, { status: 400 });
    }
    data.quantity = quantity;
  }

  if (body.lowStockThreshold !== undefined) {
    if (body.lowStockThreshold === null || body.lowStockThreshold === "") {
      data.lowStockThreshold = null;
    } else {
      const lowStockThreshold = Number(body.lowStockThreshold);
      if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
        return NextResponse.json({ error: "Low stock threshold must be zero or more" }, { status: 400 });
      }
      data.lowStockThreshold = lowStockThreshold;
    }
  }

  if (body.vatRate !== undefined) {
    if (body.vatRate === null || body.vatRate === "") {
      data.vatRate = null;
    } else {
      const vatRate = Number(body.vatRate);
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
        return NextResponse.json({ error: "VAT rate must be between 0 and 100" }, { status: 400 });
      }
      data.vatRate = vatRate;
    }
  }

  if (body.unit !== undefined) {
    data.unit = VALID_UNITS.includes(body.unit) ? body.unit : "PIECE";
  }
  if (body.barcode !== undefined) {
    data.barcode = typeof body.barcode === "string" ? body.barcode.trim() || null : null;
  }
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  // sku is intentionally never accepted here -- it's assigned once at creation
  // and is not editable, even if a caller includes it in the request body.

  const barcodeConflict = await withTenant(tenantId, (tx) =>
    findBarcodeConflict(tx, data.barcode as string | null | undefined, id)
  );
  if (barcodeConflict) {
    return NextResponse.json({ error: "This barcode is already in use by another product" }, { status: 409 });
  }

  try {
    const product = await withTenant(tenantId, (tx) => tx.product.update({ where: { id }, data }));
    return NextResponse.json(product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "This barcode is already in use by another product" }, { status: 409 });
    }
    throw err;
  }
}
