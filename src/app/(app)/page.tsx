import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/tenant-context";
import { resolveLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/get-dictionary";

export default async function HomePage() {
  const session = await auth();
  const tenantId = session!.user.tenantId;
  const dict = getDictionary(await resolveLocale());

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { tradeNameEn: true },
  });

  const [productCount, customerCount] = await withTenant(tenantId, (tx) =>
    Promise.all([tx.product.count(), tx.customer.count()])
  );

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-fg">{dict.home.welcomeBack}</div>
      <h1 className="my-2 text-balance bg-gradient-to-br from-primary-hover via-primary to-primary-dark bg-clip-text text-3xl font-extrabold text-transparent sm:text-4xl lg:text-5xl">
        {tenant.tradeNameEn}
      </h1>
      <p className="mb-9 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-muted-fg">
        <span className="h-[5px] w-[5px] rounded-full bg-accent-mint" />
        {dict.common.poweredBy}
      </p>

      <div className="flex flex-wrap justify-center gap-4">
        <div className="min-w-[130px] rounded-xl border border-border-subtle bg-white px-6 py-4 shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] transition-transform hover:-translate-y-0.5">
          <div className="text-2xl font-bold text-heading">{productCount}</div>
          <div className="mt-1 text-[11.5px] text-muted-fg">{dict.home.products}</div>
        </div>
        <div className="min-w-[130px] rounded-xl border border-border-subtle bg-white px-6 py-4 shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] transition-transform hover:-translate-y-0.5">
          <div className="text-2xl font-bold text-heading">{customerCount}</div>
          <div className="mt-1 text-[11.5px] text-muted-fg">{dict.home.customers}</div>
        </div>
      </div>
    </div>
  );
}
