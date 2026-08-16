import { NextResponse } from "next/server";

export function assertCtoRole(role: string | undefined): NextResponse | null {
  if (role !== "CTO") {
    return NextResponse.json({ error: "Only the CTO can do this" }, { status: 403 });
  }
  return null;
}
