import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: session!.user.tenantId },
    select: { tradeNameEn: true },
  });

  return (
    <AppShell tenantName={tenant.tradeNameEn} userEmail={session!.user.email ?? ""}>
      {children}
    </AppShell>
  );
}
