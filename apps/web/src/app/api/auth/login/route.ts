import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { loginWithPassword } from "@/features/auth/server/login";
import { getSessionCookieName, getSessionCookieOptions } from "@/features/auth/server/session";
import { getClientIpAddress, getUserAgent } from "@/lib/server/request-metadata";
import { errorResponse, isSameOriginRequest, parseJsonBody, RequestValidationError } from "@/lib/server/route-handler";
import { loginRequestSchema } from "@/lib/shared/validation-schemas";

/** POST /api/auth/login — verify credentials and start a server-side session. */
export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();

  // Login CSRF protection: only our own login form may submit credentials.
  if (!isSameOriginRequest(request)) {
    return errorResponse(403, "CROSS_ORIGIN_REQUEST", "Cross-origin requests are not allowed.", requestId);
  }

  let credentials;
  try {
    credentials = await parseJsonBody(request, loginRequestSchema);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", "Enter a valid e-mail and password.", requestId,
        error.fieldErrors);
    }
    throw error;
  }

  const loginResult = await loginWithPassword(credentials.email, credentials.password,
    getClientIpAddress(request.headers), getUserAgent(request.headers), requestId);

  if (loginResult.outcome === "rate_limited") {
    return errorResponse(429, "RATE_LIMITED", "Too many sign-in attempts. Please wait 15 minutes and try again.",
      requestId);
  }
  if (loginResult.outcome === "invalid_credentials") {
    return errorResponse(401, "INVALID_CREDENTIALS",
      "Invalid e-mail or password. Accounts are locked for 15 minutes after 5 failed attempts.", requestId);
  }

  const response = NextResponse.json({ data: { role: loginResult.role } },
    { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(getSessionCookieName(), loginResult.sessionToken,
    getSessionCookieOptions(loginResult.absoluteExpiresAt));
  return response;
}
