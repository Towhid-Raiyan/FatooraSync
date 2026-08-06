-- CreateIndex
CREATE INDEX "DocumentLine_documentId_idx" ON "DocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "DocumentLine_tenantId_idx" ON "DocumentLine"("tenantId");

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
