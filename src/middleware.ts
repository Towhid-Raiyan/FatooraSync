import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/auth.config";

// Deliberately built from the edge-safe authConfig, not from
// @/lib/auth/config's `auth` - see auth.config.ts for why importing the
// Credentials provider (and the argon2 native addon behind it) into
// middleware breaks the Edge runtime bundle. Reading the session JWT to
// gate routes doesn't need the provider list at all.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isPublic = req.nextUrl.pathname.startsWith("/login") || req.nextUrl.pathname.startsWith("/api/auth");
  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
