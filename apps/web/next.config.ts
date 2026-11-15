import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Static security headers for every response. The Content-Security-Policy is
 * NOT here: it needs a fresh nonce per request, so it is set in src/proxy.ts.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  // Cache Components is intentionally OFF: every dashboard page is per-user and
  // reads the session cookie, so there is no static shell to prerender. Plain
  // dynamic rendering + loading.tsx is simpler to reason about (see apps/web/CLAUDE.md).
  poweredByHeader: false,
  // The floating dev badge overlapped the sidebar user card; errors still show as an overlay.
  devIndicators: false,
  reactStrictMode: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
