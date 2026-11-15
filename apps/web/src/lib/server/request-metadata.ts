import "server-only";

import { isIP } from "node:net";

/**
 * Best-effort client IP address. On Vercel, `x-real-ip` / `x-forwarded-for` are
 * set by the platform edge (clients cannot spoof the first hop there). Locally
 * there is no proxy, so the value is usually missing.
 */
export function getClientIpAddress(requestHeaders: Headers): string | null {
  const candidates = [
    requestHeaders.get("x-real-ip"),
    requestHeaders.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && isIP(trimmed) !== 0) {
      return trimmed;
    }
  }
  return null;
}

export function getUserAgent(requestHeaders: Headers): string | null {
  return requestHeaders.get("user-agent")?.slice(0, 512) ?? null;
}
