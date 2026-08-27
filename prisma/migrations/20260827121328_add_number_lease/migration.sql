-- CreateTable
CREATE TABLE "NumberLease" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "rangeStart" INTEGER NOT NULL,
    "rangeEnd" INTEGER NOT NULL,
    "nextToIssue" INTEGER NOT NULL,
    "leasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NumberLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NumberLease_tenantId_deviceId_documentType_idx" ON "NumberLease"("tenantId", "deviceId", "documentType");

-- AddForeignKey
ALTER TABLE "NumberLease" ADD CONSTRAINT "NumberLease_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
