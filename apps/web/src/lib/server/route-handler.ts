import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import type { z } from "zod";

import { hasPermission, type Permission } from "@/features/auth/permissions";
import { recordAuditEvent } from "@/features/auth/server/audit";
import { CSRF_HEADER_NAME, isValidCsrfToken } from "@/features/auth/server/csrf";
import { getSessionCookieName, validateSessionToken } from "@/features/auth/server/session";
import { BackendUnavailableError, type BackendResponse } from "@/lib/server/backend-client";
import { getServerEnvironment } from "@/lib/server/env";
import { logger } from "@/lib/server/logger";
import { getClientIpAddress } from "@/lib/server/request-metadata";
import type { FieldError } from "@/lib/shared/api-error";
import type { ActiveSession } from "@/types/auth";

/**
 * Wrapper for every state-changing BFF endpoint (src/app/api/**\/route.ts).
 *
 * Order of checks for each request:
 *   1. Same-origin check (Origin header must be this app)        -> 403
 *   2. Valid, unexpired session cookie                           -> 401
 *   3. CSRF token header matches the session                     -> 403
 *   4. The user's role has the required permission (RBAC)        -> 403
 *   5. Handler runs; backend outages become 503, bugs become 500
 *
 * Every error uses the shared envelope {"error": {code, message, request_id}}.
 */

export interface ProtectedRouteContext {
  request: Request;
  session: ActiveSession;
  correlationId: string;
}

export class RequestValidationError extends Error {
  constructor(public readonly fieldErrors: FieldError[]) {
    super("Request validation failed");
    this.name = "RequestValidationError";
  }
}

export function errorResponse(status: number, code: string, message: string, requestId: string,
                              details?: unknown): NextResponse {
  return NextResponse.json(
    { error: { code, message, request_id: requestId, ...(details === undefined ? {} : { details }) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function isSameOriginRequest(request: Request, appOrigin = getServerEnvironment().APP_ORIGIN): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    return origin === appOrigin;
  }
  // Browsers always send Origin on cross-origin POSTs; fall back to Fetch Metadata.
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieName = getSessionCookieName();
  for (const cookiePart of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookiePart.trim().split("=");
    if (name === cookieName) {
      return valueParts.join("=");
    }
  }
  return null;
}

export function protectedRoute<RouteParams>(
  options: { permission?: Permission },
  handler: (context: ProtectedRouteContext, routeParams: RouteParams) => Promise<Response>,
): (request: Request, routeContext: { params: Promise<RouteParams> }) => Promise<Response> {
  return async (request, routeContext) => {
    const correlationId = randomUUID();
    const ipAddress = getClientIpAddress(request.headers);

    if (!isSameOriginRequest(request)) {
      await recordAuditEvent("csrf_rejected", { ipAddress, requestId: correlationId,
        details: { reason: "cross_origin", path: new URL(request.url).pathname } });
      return errorResponse(403, "CROSS_ORIGIN_REQUEST", "Cross-origin requests are not allowed.", correlationId);
    }

    const sessionToken = readSessionToken(request);
    const session = sessionToken ? await validateSessionToken(sessionToken) : null;
    if (!session) {
      return errorResponse(401, "UNAUTHENTICATED", "Your session has expired. Please sign in again.", correlationId);
    }

    if (!isValidCsrfToken(session.sessionId, request.headers.get(CSRF_HEADER_NAME))) {
      await recordAuditEvent("csrf_rejected", { actorUserId: session.user.id, ipAddress, requestId: correlationId,
        details: { reason: "invalid_token", path: new URL(request.url).pathname } });
      return errorResponse(403, "CSRF_TOKEN_INVALID", "Security token is missing or invalid. Reload the page.",
        correlationId);
    }

    if (options.permission && !hasPermission(session.user.role, options.permission)) {
      await recordAuditEvent("access_denied", { actorUserId: session.user.id, ipAddress, requestId: correlationId,
        details: { permission: options.permission, path: new URL(request.url).pathname } });
      return errorResponse(403, "FORBIDDEN", "You do not have permission to perform this action.", correlationId);
    }

    try {
      return await handler({ request, session, correlationId }, await routeContext.params);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return errorResponse(400, "VALIDATION_ERROR", "The request contains invalid fields.", correlationId,
          error.fieldErrors);
      }
      if (error instanceof BackendUnavailableError) {
        return errorResponse(503, "BACKEND_UNAVAILABLE", error.message + ". Please try again shortly.",
          correlationId);
      }
      logger.error("unhandled route error", { correlation_id: correlationId,
        error: error instanceof Error ? error.message : String(error) });
      return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred.", correlationId);
    }
  };
}

/** Parse and validate a JSON body with a Zod schema, or throw RequestValidationError. */
export async function parseJsonBody<Schema extends z.ZodType>(request: Request, schema: Schema):
  Promise<z.infer<Schema>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new RequestValidationError([{ field: "body", message: "Content-Type must be application/json" }]);
  }
  const rawBody: unknown = await request.json().catch(() => {
    throw new RequestValidationError([{ field: "body", message: "Body must be valid JSON" }]);
  });
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    throw new RequestValidationError(parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })));
  }
  return parsed.data;
}

/** Turn a backend result into a BFF response with the same status and envelope. */
export function relayBackendResponse<Data>(backendResponse: BackendResponse<Data>, correlationId: string): Response {
  if (backendResponse.ok) {
    return NextResponse.json(backendResponse.data, {
      status: backendResponse.status,
      headers: { "Cache-Control": "no-store", "X-Correlation-ID": correlationId },
    });
  }
  return errorResponse(backendResponse.status, backendResponse.error.code, backendResponse.error.message,
    correlationId, backendResponse.error.details);
}
