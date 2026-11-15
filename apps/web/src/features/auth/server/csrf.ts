import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getServerEnvironment } from "@/lib/server/env";

/**
 * CSRF (Cross-Site Request Forgery) tokens.
 *
 * The token is an HMAC of the session ID with a server secret. A malicious site
 * can make the browser SEND our cookie, but it cannot READ our pages, so it can
 * never learn this token. Every state-changing request must echo it in the
 * X-CSRF-Token header.
 */
export const CSRF_HEADER_NAME = "x-csrf-token";

export function createCsrfToken(sessionId: string, secret = getServerEnvironment().CSRF_SECRET): string {
  return createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");
}

export function isValidCsrfToken(sessionId: string, providedToken: string | null,
                                 secret = getServerEnvironment().CSRF_SECRET): boolean {
  if (!providedToken) {
    return false;
  }
  const expected = Buffer.from(createCsrfToken(sessionId, secret));
  const provided = Buffer.from(providedToken);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
