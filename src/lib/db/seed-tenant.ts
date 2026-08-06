import { prisma } from "./client";
import { hashPassword } from "@/lib/auth/password";

export interface SeedTenantInput {
  legalName: string;
  tradeNameEn: string;
  tradeNameAr?: string;
  vatNumber: string;
  ownerEmail: string;
  ownerPassword: string;
}

export async function seedTenant(input: SeedTenantInput) {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        legalName: input.legalName,
        tradeNameEn: input.tradeNameEn,
        tradeNameAr: input.tradeNameAr,
        vatNumber: input.vatNumber,
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: input.ownerEmail,
        passwordHash: await hashPassword(input.ownerPassword),
      },
    });

    const settings = await tx.settings.create({
      data: { tenantId: tenant.id },
    });

    const walkInCustomer = await tx.customer.create({
      data: { tenantId: tenant.id, name: "Walk-in Customer", isWalkIn: true },
    });

    return { tenant, user, settings, walkInCustomer };
  });
}
