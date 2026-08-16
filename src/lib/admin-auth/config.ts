import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";
import { isRateLimited, recordFailedAttempt, resetAttempts } from "@/lib/auth/rate-limit";

function clientIp(request: Request): string | undefined {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? undefined;
}

export async function authorize(credentials: { email: string; password: string }, ip?: string) {
  const email = credentials.email.trim().toLowerCase();
  const rateLimitKey = ip ? `admin:${email}:${ip}` : `admin:${email}`;

  if (isRateLimited(rateLimitKey)) return null;

  const staff = await prisma.agencyStaff.findUnique({ where: { email } });
  if (!staff) {
    recordFailedAttempt(rateLimitKey);
    return null;
  }

  const valid = await verifyPassword(credentials.password, staff.passwordHash);
  if (!valid) {
    recordFailedAttempt(rateLimitKey);
    return null;
  }

  resetAttempts(rateLimitKey);
  return { id: staff.id, email: staff.email, agencyStaffId: staff.id, role: staff.role };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: "/api/admin-auth",
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 },
  cookies: {
    sessionToken: {
      name: "admin-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: (credentials, request) =>
        authorize(
          { email: credentials.email as string, password: credentials.password as string },
          clientIp(request)
        ),
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        const typedUser = user as { agencyStaffId: string; role: string };
        token.agencyStaffId = typedUser.agencyStaffId;
        token.role = typedUser.role;
      }
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, agencyStaffId: token.agencyStaffId as string, role: token.role as string },
    }),
  },
});
