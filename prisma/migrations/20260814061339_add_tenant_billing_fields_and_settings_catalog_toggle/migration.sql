-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('TRIALING', 'ACTIVE', 'COMPLIMENTARY', 'PAST_DUE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "cashierCanManageCatalog" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "billingStatus" "BillingStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "featureFlags" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);
