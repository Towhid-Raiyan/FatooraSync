import type { Settings } from "@prisma/client";
import type { TenantClient } from "@/lib/db/tenant-context";
import { resolveLabelBarcode } from "./resolve-label-barcode";
import { generateBarcodeDataUrl } from "./generate-barcode-image";
import { calculateLabelPrice } from "./label-price";

export interface LabelItemInput {
  productId: string;
  copies: number;
}

export interface LabelItem {
  productId: string;
  productName: string;
  price: string;
  barcodeText: string;
  barcodeDataUrl: string;
  copies: number;
}

export class LabelBuildError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// A generous but real ceiling -- protects against a mistyped quantity (or a
// deliberately abusive request) generating thousands of barcode images and a
// huge PDF in one request, not a limit any real restock/price-change batch
// should ever bump into.
const MAX_COPIES_PER_ITEM = 500;
const MAX_TOTAL_COPIES = 1000;

export function parseLabelItemsInput(body: unknown): LabelItemInput[] {
  const rawItems = body && typeof body === "object" && "items" in body ? (body as { items: unknown }).items : null;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new LabelBuildError("Add at least one product", 400);
  }

  const items: LabelItemInput[] = [];
  let totalCopies = 0;
  for (const raw of rawItems) {
    const productId = raw && typeof raw === "object" && "productId" in raw ? (raw as { productId: unknown }).productId : null;
    const copies = raw && typeof raw === "object" && "copies" in raw ? Number((raw as { copies: unknown }).copies) : NaN;
    if (typeof productId !== "string" || !productId) {
      throw new LabelBuildError("Each item needs a productId", 400);
    }
    if (!Number.isFinite(copies) || !Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES_PER_ITEM) {
      throw new LabelBuildError(`Copies must be a whole number between 1 and ${MAX_COPIES_PER_ITEM}`, 400);
    }
    totalCopies += copies;
    items.push({ productId, copies });
  }
  if (totalCopies > MAX_TOTAL_COPIES) {
    throw new LabelBuildError(`A single print job can't exceed ${MAX_TOTAL_COPIES} labels total`, 400);
  }
  return items;
}

// Shared by the print-data (browser print) and pdf (download) routes -- both
// need the exact same resolved barcode/price data per product, just rendered
// through a different template afterward.
export async function buildLabelItems(
  tx: TenantClient,
  settings: Settings,
  items: LabelItemInput[]
): Promise<LabelItem[]> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const products = await tx.product.findMany({ where: { id: { in: productIds } } });
  const productById = new Map(products.map((p) => [p.id, p]));

  const missing = productIds.filter((id) => !productById.has(id));
  if (missing.length > 0) {
    throw new LabelBuildError("One or more products are no longer available", 404);
  }

  const defaultVatRate = Number(settings.defaultVatRate);
  const result: LabelItem[] = [];
  for (const item of items) {
    const product = productById.get(item.productId)!;
    const barcodeText = await resolveLabelBarcode(tx, product);
    const barcodeDataUrl = await generateBarcodeDataUrl(barcodeText);
    const price = calculateLabelPrice(
      Number(product.unitPrice),
      product.vatRate !== null ? Number(product.vatRate) : null,
      defaultVatRate
    );
    result.push({
      productId: product.id,
      productName: product.nameEn,
      price: price.toFixed(2),
      barcodeText,
      barcodeDataUrl,
      copies: item.copies,
    });
  }
  return result;
}
