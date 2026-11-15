import { describe, expect, it } from "vitest";

import { hasPermission, permissions } from "@/features/auth/permissions";
import { createCsrfToken, isValidCsrfToken } from "@/features/auth/server/csrf";
import { isSameOriginRequest } from "@/lib/server/route-handler";
import { getSafeRedirectPath } from "@/lib/shared/safe-redirect";

const SECRET = "test-secret-that-is-at-least-32-characters-long";

describe("CSRF tokens", () => {
  it("accepts the token issued for the same session", () => {
    const token = createCsrfToken("session-a", SECRET);
    expect(isValidCsrfToken("session-a", token, SECRET)).toBe(true);
  });

  it("rejects tokens from another session, another secret, or missing tokens", () => {
    const token = createCsrfToken("session-a", SECRET);
    expect(isValidCsrfToken("session-b", token, SECRET)).toBe(false);
    expect(isValidCsrfToken("session-a", token, `${SECRET}-rotated`)).toBe(false);
    expect(isValidCsrfToken("session-a", null, SECRET)).toBe(false);
    expect(isValidCsrfToken("session-a", "", SECRET)).toBe(false);
    expect(isValidCsrfToken("session-a", `${token}x`, SECRET)).toBe(false);
  });
});

describe("getSafeRedirectPath (open redirect protection)", () => {
  it.each([
    ["/payments", "/payments"],
    ["/payments?status=failed", "/payments?status=failed"],
    ["/incidents/123", "/incidents/123"],
  ])("allows internal path %s", (input, expected) => {
    expect(getSafeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "javascript:alert(1)",
    "/login",
    "/api/auth/logout",
    "dashboard",
    "/path\nwith-newline",
    "",
    null,
    undefined,
  ])("falls back to /dashboard for %s", (input) => {
    expect(getSafeRedirectPath(input)).toBe("/dashboard");
  });
});

describe("RBAC permissions", () => {
  it("gives admins every permission", () => {
    for (const permission of Object.keys(permissions) as (keyof typeof permissions)[]) {
      expect(hasPermission("admin", permission)).toBe(true);
    }
  });

  it("gives viewers no write permission", () => {
    for (const permission of Object.keys(permissions) as (keyof typeof permissions)[]) {
      expect(hasPermission("viewer", permission)).toBe(false);
    }
  });
});

describe("isSameOriginRequest", () => {
  const appOrigin = "http://localhost:3000";
  const buildRequest = (headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/payments", { method: "POST", headers });

  it("accepts the app's own origin", () => {
    expect(isSameOriginRequest(buildRequest({ origin: appOrigin }), appOrigin)).toBe(true);
  });

  it("rejects other origins, including look-alikes", () => {
    for (const origin of ["https://evil.example", "http://localhost:3001", "http://localhost:3000.evil.example", "null"]) {
      expect(isSameOriginRequest(buildRequest({ origin }), appOrigin)).toBe(false);
    }
  });

  it("falls back to Fetch Metadata when Origin is missing", () => {
    expect(isSameOriginRequest(buildRequest({ "sec-fetch-site": "same-origin" }), appOrigin)).toBe(true);
    expect(isSameOriginRequest(buildRequest({ "sec-fetch-site": "cross-site" }), appOrigin)).toBe(false);
    expect(isSameOriginRequest(buildRequest({}), appOrigin)).toBe(false);
  });
});
