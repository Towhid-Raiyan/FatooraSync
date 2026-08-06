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
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.tenantId = (user as { tenantId: string }).tenantId;
      }
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, tenantId: token.tenantId as string },
    }),
  },
};
