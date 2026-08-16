-- CreateEnum
CREATE TYPE "AgencyStaffRole" AS ENUM ('CTO', 'DEVELOPER');

-- CreateTable
CREATE TABLE "AgencyStaff" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AgencyStaffRole" NOT NULL DEFAULT 'DEVELOPER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "agencyStaffId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tenantId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyStaff_email_key" ON "AgencyStaff"("email");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_agencyStaffId_fkey" FOREIGN KEY ("agencyStaffId") REFERENCES "AgencyStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
