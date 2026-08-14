import type { NextAuthConfig } from "next-auth";

/**
 * The edge-safe half of the Auth.js config: session strategy and callbacks
 * only, no providers. src/middleware.ts runs in the Edge runtime and imports
 * only this file, so it never pulls in the Credentials provider's authorize()
 * chain (password.ts -> argon2, a native Node addon that Turbopack can't
 * bundle for the Edge runtime - importing it from middleware fails with
 * "Cannot find module 'node:crypto'" at dev-server request time). The full
 * config in config.ts spreads this and adds the Credentials provider, for use
 * in the Node.js-runtime API route handler.
 */
export const authConfig: NextAuthConfig = {
  // 24h expiry bounds exposure from the JWT strategy. Staff accounts
  // (Cashiers) now exist, but session revocation on deactivation is an
  // accepted gap for now: deactivating a Cashier blocks their next login but
  // doesn't invalidate an already-issued token, so access can persist up to maxAge.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 },
  providers: [],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        const typedUser = user as { tenantId: string; role: string };
        token.tenantId = typedUser.tenantId;
        token.role = typedUser.role;
      }
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, tenantId: token.tenantId as string, role: token.role as string },
    }),
  },
};
