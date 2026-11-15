import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { startDemoSession } from "@/features/auth/server/demo-access";
import { getSessionCookieName, getSessionCookieOptions } from "@/features/auth/server/session";
import { getClientIpAddress, getUserAgent } from "@/lib/server/request-metadata";
import { errorResponse, isSameOriginRequest } from "@/lib/server/route-handler";

/** POST /api/auth/demo — start a read-only guest session (if the public demo is enabled). */
export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  if (!isSameOriginRequest(request)) {
    return errorResponse(403, "CROSS_ORIGIN_REQUEST", "Cross-origin requests are not allowed.", requestId);
  }

  const result = await startDemoSession(getClientIpAddress(request.headers), getUserAgent(request.headers), requestId);
  if (result.outcome === "disabled") {
    return errorResponse(404, "NOT_FOUND", "The public demo is not available.", requestId);
  }
  if (result.outcome === "rate_limited") {
    return errorResponse(429, "RATE_LIMITED", "Too many demo sessions from your network. Try again later.", requestId);
  }

  const response = NextResponse.json({ data: { role: "viewer" } }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(getSessionCookieName(), result.sessionToken, getSessionCookieOptions(result.absoluteExpiresAt));
  return response;
}
