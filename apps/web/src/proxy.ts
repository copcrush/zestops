import { type NextRequest, NextResponse } from "next/server";

/**
 * Runs before every page request (Next.js 16 "Proxy", formerly Middleware).
 *
 * 1. Content-Security-Policy with a fresh nonce per request: only scripts that
 *    carry the nonce may run, which blocks most injected-script (XSS) attacks.
 * 2. Optimistic auth redirect: no session cookie -> /login. This is only a UX
 *    shortcut; the real check happens on the server for every page and API call.
 */
const PUBLIC_PATHS = ["/login", "/unauthorized"];
const SESSION_COOKIE_NAMES = ["__Host-zestops_session", "zestops_session"];

function buildContentSecurityPolicy(nonce: string, isDevelopment: boolean): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only in development: React uses eval for better error stacks there.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self'${isDevelopment ? " 'unsafe-inline'" : ` 'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  const isPublicPath = PUBLIC_PATHS.some((publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`));

  if (!hasSessionCookie && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname + search);
    }
    return NextResponse.redirect(loginUrl);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  // Pages only: skip API routes (they return JSON and do their own auth), static files and images.
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
