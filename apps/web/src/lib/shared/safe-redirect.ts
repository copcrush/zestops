/**
 * Only allow redirects to paths inside this app after login.
 * Prevents "open redirect" attacks such as /login?next=https://evil.example
 * or /login?next=//evil.example (protocol-relative URL).
 */
export function getSafeRedirectPath(requestedPath: string | null | undefined, fallbackPath = "/dashboard"): string {
  if (!requestedPath || !requestedPath.startsWith("/") || requestedPath.startsWith("//")
      || requestedPath.includes("\\") || /[\u0000-\u001f]/.test(requestedPath)) {
    return fallbackPath;
  }
  if (requestedPath.startsWith("/login") || requestedPath.startsWith("/api/")) {
    return fallbackPath;
  }
  return requestedPath;
}
