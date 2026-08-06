import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/client";
import { verifyPassword } from "./password";
import { isRateLimited } from "./rate-limit";
import { authConfig } from "./auth.config";

export async function authorize(credentials: { email: string; password: string }) {
  if (isRateLimited(credentials.email)) return null;

  const user = await prisma.user.findUnique({ where: { email: credentials.email } });
  if (!user) return null;

  const valid = await verifyPassword(credentials.password, user.passwordHash);
  if (!valid) return null;

  return { id: user.id, email: user.email, tenantId: user.tenantId };
}

// Auth.js rejects "database" session strategy when Credentials is the only
// provider (Signing in with credentials only supported if JWT strategy is
// enabled - enforced in @auth/core's assertConfig). A PrismaAdapter is also
// not usable here without OAuth/email providers: it depends on Account and
// VerificationToken models that don't exist in this schema (auth only needs
// User + Session per Task 2/3's design), and its session/user persistence
// methods go unused under the JWT strategy anyway - so @auth/prisma-adapter
// isn't installed. Sessions are JWT-based (24h expiry, see auth.config.ts),
// and tenantId travels through the jwt/session callbacks there instead of
// via an adapter's user object.
//
// This full config (with the Credentials provider) is only safe to import
// from Node.js-runtime code (the API route handler, server components,
// tests) - see auth.config.ts for why middleware.ts must not import it.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: (credentials) =>
        authorize({ email: credentials.email as string, password: credentials.password as string }),
    }),
  ],
});
