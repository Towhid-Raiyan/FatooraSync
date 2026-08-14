import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      tenantId: string;
      role: string;
    } & DefaultSession["user"];
  }
}
