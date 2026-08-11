-- CreateEnum
CREATE TYPE "PrintFormat" AS ENUM ('THERMAL', 'A4');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "printFormat" "PrintFormat" NOT NULL DEFAULT 'THERMAL';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "phone" TEXT;
