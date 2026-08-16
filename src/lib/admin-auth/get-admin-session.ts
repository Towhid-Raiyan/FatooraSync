import { auth } from "./config";

export interface AdminSessionUser {
  agencyStaffId: string;
  role: "CTO" | "DEVELOPER";
}

export async function getAdminSession(): Promise<{ user: AdminSessionUser } | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { user: session.user as unknown as AdminSessionUser };
}
