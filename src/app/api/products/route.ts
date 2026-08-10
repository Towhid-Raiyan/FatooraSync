import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { Unit } from "@prisma/client";
import { auth } from "@/lib/auth/config";
import { withTenant } from "@/lib/db/tenant-context";
import { findUniquenessConflict } from "./check-uniqueness";

const VALID_UNITS: Unit[] = ["PIECE", "KG", "BOX", "CARTON", "LITER"];

// Not called by this branch's own UI (page.tsx fetches directly via withTenant) — reserved
// for the future Sales Receipt screen's product picker, per the design spec.
export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;

  const products = await withTenant(tenantId, (tx) => tx.product.findMany({ orderBy: { nameEn: "asc" } }));
  return NextResponse.json(products);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  const body = await request.json();

  const nameEn = typeof body.nameEn === "string" ? body.nameEn.trim() : "";
  if (!nameEn) {
    return NextResponse.json({ error: "English name is required" }, { status: 400 });
  }

  const unitPrice = Number(body.unitPrice);
  if (body.unitPrice === "" || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return NextResponse.json({ error: "Unit price is required and must be zero or more" }, { status: 400 });
  }

  let quantity = 0;
  if (body.quantity !== undefined && body.quantity !== "") {
    quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return NextResponse.json({ error: "Quantity must be zero or more" }, { status: 400 });
    }
  }

  let vatRate: number | null = null;
  if (body.vatRate !== undefined && body.vatRate !== null && body.vatRate !== "") {
    vatRate = Number(body.vatRate);
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return NextResponse.json({ error: "VAT rate must be between 0 and 100" }, { status: 400 });
    }
  }

  const unit: Unit = VALID_UNITS.includes(body.unit) ? body.unit : "PIECE";
  const sku = typeof body.sku === "string" ? body.sku.trim() || null : null;
  const barcode = typeof body.barcode === "string" ? body.barcode.trim() || null : null;

  const conflict = await withTenant(tenantId, (tx) => findUniquenessConflict(tx, { sku, barcode }));
  if (conflict) {
    return NextResponse.json(
      { error: `This ${conflict === "sku" ? "SKU" : "barcode"} is already in use by another product` },
      { status: 409 }
    );
  }

  try {
    const product = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: {
          nameEn,
          nameAr: body.nameAr || null,
          sku,
          barcode,
          unit,
          unitPrice,
          vatRate,
          quantity,
        } as Prisma.ProductUncheckedCreateInput,
      })
    );
    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    // Backstop for the rare race between the proactive check above and this write —
    // the check already names the specific field in the common case.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "This SKU or barcode is already in use by another product" },
        { status: 409 }
      );
    }
    throw err;
  }
}
