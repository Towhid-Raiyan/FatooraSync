import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/client";
import { verifyPassword } from "./password";
import { isRateLimited, recordFailedAttempt, resetAttempts } from "./rate-limit";
import { authConfig } from "./auth.config";

// Extracts a best-effort client IP from standard proxy headers. Vercel (and
// most reverse proxies) set x-forwarded-for; it's absent for direct
// connections (e.g. local dev without a proxy, or a raw call to authorize()
// like the tests and seed script use), in which case rate-limit keying
// falls back to email alone.
function clientIp(request: Request): string | undefined {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? undefined;
}

export async function authorize(credentials: { email: string; password: string }, ip?: string) {
  // Keying on email+IP (when an IP is available) means an attacker who
  // knows an owner's email can only lock out login attempts coming from
  // their own IP, not the real owner's - closing the account-lockout DoS
  // that pure email-keying would allow. Only failed attempts count toward
  // the limit (see rate-limit.ts): a successful login clears the counter
  // instead of contributing to it, so genuine repeated logins never lock
  // out the account owner.
  const rateLimitKey = ip ? `${credentials.email}:${ip}` : credentials.email;

  if (isRateLimited(rateLimitKey)) return null;

  const user = await prisma.user.findUnique({ where: { email: credentials.email } });
  if (!user) {
    recordFailedAttempt(rateLimitKey);
    return null;
  }

  const valid = await verifyPassword(credentials.password, user.passwordHash);
  if (!valid) {
    recordFailedAttempt(rateLimitKey);
    return null;
  }

  resetAttempts(rateLimitKey);
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
      authorize: (credentials, request) =>
        authorize(
          { email: credentials.email as string, password: credentials.password as string },
          clientIp(request)
        ),
    }),
  ],
});
