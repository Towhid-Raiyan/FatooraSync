import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getAdminSession } from "@/lib/admin-auth/get-admin-session";
import { signOut } from "@/lib/admin-auth/config";
import { AdminShell } from "@/components/admin/admin-shell";

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
    <AdminShell email={staff.email} role={session.user.role} signOutAction={handleSignOut}>
      {children}
    </AdminShell>
  );
}
