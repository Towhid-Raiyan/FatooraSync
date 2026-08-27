import Dexie, { type Table } from "dexie";

export interface CachedProduct {
  id: string;
  nameEn: string;
  nameAr: string | null;
  sku: string;
  barcode: string | null;
  unitPrice: string;
  vatRate: string | null;
  quantity: string;
  unit: string;
  isActive: boolean;
}

export interface CachedCustomer {
  id: string;
  name: string;
  vatId: string | null;
  crNumber: string | null;
  phone: string | null;
  address: string | null;
  isWalkIn: boolean;
  isActive: boolean;
}

export interface CachedSettings {
  id: "singleton";
  defaultVatRate: string;
  printFormat: "THERMAL" | "A4";
}

export interface CachedTenant {
  id: "singleton";
  tradeNameEn: string;
  tradeNameAr: string | null;
  legalName: string;
  vatNumber: string;
  crNumber: string | null;
  phone: string | null;
  address: string | null;
}

export interface StoredNumberLease {
  id?: number; // Dexie auto-increment primary key
  documentType: "SALES_RECEIPT" | "QUOTATION";
  rangeStart: number;
  rangeEnd: number;
  nextToIssue: number;
}

export interface PendingLine {
  productId: string;
  quantity: number;
  discount: number;
  unitPrice: number;
}

export interface PendingDocument {
  uuid: string; // primary key -- also the idempotency key sent to the server
  number: number;
  customer: { name: string; vatId: string; crNumber: string; phone: string; address: string };
  lines: PendingLine[];
  notes: string;
  createdAt: string; // ISO 8601, set at local creation time for offline printing
  status: "pending" | "syncing" | "failed";
}

class OfflineDatabase extends Dexie {
  products!: Table<CachedProduct, string>;
  customers!: Table<CachedCustomer, string>;
  settings!: Table<CachedSettings, string>;
  tenant!: Table<CachedTenant, string>;
  numberLeases!: Table<StoredNumberLease, number>;
  pendingReceipts!: Table<PendingDocument, string>;
  pendingQuotations!: Table<PendingDocument, string>;

  constructor() {
    super("fatoorasync-offline");
    this.version(1).stores({
      products: "id, sku, barcode",
      customers: "id, vatId",
      settings: "id",
      tenant: "id",
      numberLeases: "++id, documentType",
      pendingReceipts: "uuid, status",
      pendingQuotations: "uuid, status",
    });
  }
}

export const offlineDb = new OfflineDatabase();
