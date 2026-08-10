import type { TenantClient } from "@/lib/db/tenant-context";

// Atomically consumes the tenant's next SKU number (a plain UPDATE ... SET n = n + 1
// is a single, row-locked statement in Postgres, so concurrent creates never collide)
// and formats it as SKU-000001, SKU-000002, etc. Six digits comfortably covers any
// SME's inventory size without ever needing a wider or narrower scheme.
export async function generateNextSku(tx: TenantClient, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.update({
    where: { id: tenantId },
    data: { nextProductSkuNumber: { increment: 1 } },
    select: { nextProductSkuNumber: true },
  });
  const sequenceNumber = tenant.nextProductSkuNumber - 1;
  return `SKU-${String(sequenceNumber).padStart(6, "0")}`;
}
