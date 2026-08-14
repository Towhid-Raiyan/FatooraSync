import { NextResponse } from "next/server";

export function assertOwnerRole(role: string | undefined): NextResponse | null {
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Only the Owner can do this" }, { status: 403 });
  }
  return null;
}
