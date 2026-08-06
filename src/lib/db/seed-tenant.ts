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

export interface SeedTenantResult {
  tenant: { id: string; legalName: string; tradeNameEn: string; tradeNameAr: string | null; vatNumber: string };
  user: { id: string; tenantId: string; email: string; passwordHash: string };
  settings: { tenantId: string; defaultVatRate: number };
  walkInCustomer: { id: string; tenantId: string; name: string; isWalkIn: boolean };
}

export async function seedTenant(input: SeedTenantInput): Promise<SeedTenantResult> {
  // Uses raw prisma.$transaction instead of withTenant() because this is a bootstrap
  // operation creating a new tenant; withTenant() scopes queries to an *existing* tenant.
  // Each create() call explicitly sets the correct tenantId, so there is no cross-tenant risk.
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
