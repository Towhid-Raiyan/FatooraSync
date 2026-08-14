import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { AppShell } from "@/components/shell/app-shell";
import { BlockedScreen } from "@/components/shell/blocked-screen";
import { isAccessAllowed } from "@/lib/billing/access-gate";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: session!.user.tenantId },
    select: { tradeNameEn: true, billingStatus: true, trialEndsAt: true },
  });

  if (!isAccessAllowed(tenant.billingStatus, tenant.trialEndsAt)) {
    return <BlockedScreen />;
  }

  return (
    <AppShell tenantName={tenant.tradeNameEn} userEmail={session!.user.email ?? ""}>
      {children}
    </AppShell>
  );
}
