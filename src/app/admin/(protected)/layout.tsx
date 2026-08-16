import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { signOut } from "@/lib/admin-auth/config";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const staff = await prisma.agencyStaff.findUniqueOrThrow({
    where: { id: session.user.agencyStaffId },
    select: { email: true },
  });

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/admin/login" });
  }

  return (
    <div dir="ltr" className="flex min-h-screen bg-neutral-50">
      <AdminSidebar email={staff.email} role={session.user.role} signOutAction={handleSignOut} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
