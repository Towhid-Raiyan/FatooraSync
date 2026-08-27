import { NextResponse } from "next/server";

// Used only for real connectivity detection (src/lib/offline/connectivity.ts)
// -- navigator.onLine alone can't distinguish "Wi-Fi connected, server
// unreachable" from genuinely online. No auth, no DB call: the point is to
// be as cheap and fast as possible to ping frequently.
export async function GET() {
  return NextResponse.json({ ok: true });
}
