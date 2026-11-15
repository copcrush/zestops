import { NextResponse } from "next/server";

/** GET /api/health — liveness of the web app (no secrets, no dependencies). */
export function GET(): Response {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
