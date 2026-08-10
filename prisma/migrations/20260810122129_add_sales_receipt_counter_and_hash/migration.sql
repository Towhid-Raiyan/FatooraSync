-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "lastSalesReceiptHash" TEXT,
ADD COLUMN     "nextSalesReceiptNumber" INTEGER NOT NULL DEFAULT 1;
