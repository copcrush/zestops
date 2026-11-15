import { extractFieldErrors, type FieldError, isApiErrorBody } from "@/lib/shared/api-error";

/**
 * Typed fetch wrapper for calling the BFF (/api/...) from Client Components.
 * Adds the CSRF header, parses the shared error envelope, and sends the user to
 * the login page if the session expired.
 */
export type ApiResult<Data> =
  | { ok: true; data: Data }
  | { ok: false; status: number; code: string; message: string; fieldErrors: FieldError[] };

export async function sendApiRequest<Data>(path: string, options: {
  method: "POST" | "PATCH" | "DELETE";
  csrfToken: string;
  body?: unknown;
}): Promise<ApiResult<Data>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": options.csrfToken,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, code: "NETWORK_ERROR", message: "Network error. Check your connection.",
      fieldErrors: [] };
  }

  const responseBody: unknown = await response.json().catch(() => null);

  if (response.status === 401) {
    const nextPath = window.location.pathname + window.location.search;
    // Full page load on purpose: the session is gone, so drop all client-side state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(nextPath)}&reason=expired`);
  }
  if (response.ok) {
    const data = (responseBody as { data?: Data } | null)?.data ?? (responseBody as Data);
    return { ok: true, data };
  }
  if (isApiErrorBody(responseBody)) {
    return { ok: false, status: response.status, code: responseBody.error.code,
      message: responseBody.error.message, fieldErrors: extractFieldErrors(responseBody.error.details) };
  }
  return { ok: false, status: response.status, code: "UNKNOWN_ERROR",
    message: "Unexpected response from the server.", fieldErrors: [] };
}

/** A new random key per form submission, so a double-click never creates two payments. */
export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function fieldErrorFor(fieldErrors: FieldError[], field: string): string | undefined {
  return fieldErrors.find((fieldError) => fieldError.field === field)?.message;
}
