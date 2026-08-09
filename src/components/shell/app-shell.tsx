import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  tenantName,
  userEmail,
  children,
}: {
  tenantName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar tenantName={tenantName} />

      <div className="relative flex flex-1 flex-col overflow-hidden bg-bg-app">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-primary-mid) 1px, transparent 1px), linear-gradient(90deg, var(--color-primary-mid) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -end-16 -top-24 h-80 w-80 rounded-full bg-accent-mint opacity-[0.18] blur-[60px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -start-10 h-64 w-64 rounded-full bg-accent-mint opacity-[0.18] blur-[60px]"
        />

        <Topbar userEmail={userEmail} />

        <main className="relative z-10 flex-1 overflow-auto p-7">{children}</main>
      </div>
    </div>
  );
}
