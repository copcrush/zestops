import "server-only";

import { randomUUID } from "node:crypto";

import { getServerEnvironment } from "@/lib/server/env";
import { type BackendAudience, signInternalToken } from "@/lib/server/internal-token";
import { logger } from "@/lib/server/logger";
import { type ApiErrorBody, isApiErrorBody } from "@/lib/shared/api-error";
import type { Role } from "@/types/auth";

/**
 * The only place where the web app talks to the Go and Python services.
 * Every call:
 *  - carries a fresh internal JWT for the signed-in user (never a browser token)
 *  - carries a correlation ID so logs can be followed across services
 *  - has a timeout, and is never cached
 */
export type BackendName = "payment" | "monitoring";

const BACKEND_AUDIENCES: Record<BackendName, BackendAudience> = {
  payment: "zestops-payment-api",
  monitoring: "zestops-monitoring-api",
};

const BACKEND_DISPLAY_NAMES: Record<BackendName, string> = {
  payment: "Payment API",
  monitoring: "Monitoring API",
};

const REQUEST_TIMEOUT_MILLISECONDS = 10_000;

export interface BackendActor {
  id: string;
  role: Role;
}

export interface BackendRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  jsonBody?: unknown;
  idempotencyKey?: string;
  correlationId?: string;
}

export type BackendResponse<Data> =
  | { ok: true; status: number; data: Data; headers: Headers }
  | { ok: false; status: number; error: ApiErrorBody["error"] };

/** The backend could not be reached at all (down, sleeping, timeout). */
export class BackendUnavailableError extends Error {
  constructor(public readonly backend: BackendName, cause: unknown) {
    super(`${BACKEND_DISPLAY_NAMES[backend]} is unavailable`, { cause });
    this.name = "BackendUnavailableError";
  }
}

/** The backend answered with an error status (used by read helpers that throw). */
export class BackendRequestError extends Error {
  constructor(public readonly backend: BackendName, public readonly status: number,
              public readonly errorBody: ApiErrorBody["error"]) {
    super(`${BACKEND_DISPLAY_NAMES[backend]} returned ${status} ${errorBody.code}`);
    this.name = "BackendRequestError";
  }
}

function getBaseUrl(backend: BackendName): string {
  const environment = getServerEnvironment();
  return backend === "payment" ? environment.PAYMENT_API_BASE_URL : environment.MONITORING_API_BASE_URL;
}

export async function callBackend<Data>(backend: BackendName, path: string, actor: BackendActor,
                                        options: BackendRequestOptions = {}): Promise<BackendResponse<Data>> {
  const method = options.method ?? "GET";
  const correlationId = options.correlationId ?? randomUUID();
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${await signInternalToken(actor, BACKEND_AUDIENCES[backend])}`,
    "X-Correlation-ID": correlationId,
  };
  if (options.jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(new URL(path, getBaseUrl(backend)), {
      method,
      headers,
      body: options.jsonBody === undefined ? undefined : JSON.stringify(options.jsonBody),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });
  } catch (error) {
    logger.error("backend unreachable", { backend, method, path, correlation_id: correlationId,
      error: error instanceof Error ? error.message : String(error) });
    throw new BackendUnavailableError(backend, error);
  }

  const responseBody: unknown = await response.json().catch(() => null);
  logger.info("backend call", { backend, method, path, status: response.status,
    duration_ms: Date.now() - startedAt, correlation_id: correlationId,
    backend_request_id: response.headers.get("x-request-id") });

  if (response.ok) {
    return { ok: true, status: response.status, data: responseBody as Data, headers: response.headers };
  }
  if (isApiErrorBody(responseBody)) {
    return { ok: false, status: response.status, error: responseBody.error };
  }
  return { ok: false, status: 502, error: { code: "BAD_GATEWAY",
    message: `${BACKEND_DISPLAY_NAMES[backend]} returned an unexpected response.` } };
}

/** For Server Component reads: returns data or throws, so error.tsx / try-catch can show an error state. */
export async function getFromBackend<Data>(backend: BackendName, path: string, actor: BackendActor): Promise<Data> {
  const response = await callBackend<Data>(backend, path, actor);
  if (!response.ok) {
    throw new BackendRequestError(backend, response.status, response.error);
  }
  return response.data;
}

export function describeBackendFailure(error: unknown): string {
  if (error instanceof BackendUnavailableError) {
    return `${BACKEND_DISPLAY_NAMES[error.backend]} is unreachable. It may be starting up (free hosting sleeps when idle) — try again in a moment.`;
  }
  if (error instanceof BackendRequestError) {
    return `${BACKEND_DISPLAY_NAMES[error.backend]} error: ${error.errorBody.message}`;
  }
  return "Something went wrong while loading this data.";
}
