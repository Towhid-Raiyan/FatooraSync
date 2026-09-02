-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CREDIT_NOTE';

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN';

-- AlterTable
ALTER TABLE "DocumentLine" ADD COLUMN     "creditedForLineId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "nextCreditNoteNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Tenant" RENAME COLUMN "lastSalesReceiptHash" TO "lastInvoiceHash";

-- CreateIndex
CREATE INDEX "DocumentLine_creditedForLineId_idx" ON "DocumentLine"("creditedForLineId");

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_creditedForLineId_fkey" FOREIGN KEY ("creditedForLineId") REFERENCES "DocumentLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
