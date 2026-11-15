#!/usr/bin/env node
/**
 * Post-deployment smoke test (read-only, safe for production).
 *
 *   node scripts/smoke-test.mjs \
 *     --web https://zestops.example.vercel.app \
 *     --payment https://zestops-payment-api.onrender.com \
 *     --monitoring https://zestops-monitoring-api.onrender.com
 *
 * Checks: health endpoints, that protected APIs reject anonymous calls, that the
 * login page loads with security headers, and that docs/demo endpoints are hidden.
 * Free-tier backends may need ~60 s to wake up, so requests are retried.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { web: { type: "string" }, payment: { type: "string" }, monitoring: { type: "string" } },
});
if (!values.web || !values.payment || !values.monitoring) {
  console.error("Usage: node scripts/smoke-test.mjs --web <url> --payment <url> --monitoring <url>");
  process.exit(2);
}

const results = [];

async function fetchWithRetry(url, options = {}, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...options });
      if (response.status !== 502 && response.status !== 503) return response;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return fetch(url, { redirect: "manual", ...options });
}

async function check(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [label, baseUrl] of [["payment", values.payment], ["monitoring", values.monitoring]]) {
  await check(`${label} /health/ready is ok`, async () => {
    const response = await fetchWithRetry(`${baseUrl}/health/ready`);
    expect(response.status === 200, `status ${response.status}`);
    const body = await response.json();
    expect(body.status === "ok", `body ${JSON.stringify(body)}`);
  });
  await check(`${label} rejects anonymous /v1 calls`, async () => {
    const path = label === "payment" ? "/v1/payments" : "/v1/services";
    const response = await fetchWithRetry(`${baseUrl}${path}`);
    expect(response.status === 401, `expected 401, got ${response.status}`);
    expect(!response.headers.get("access-control-allow-origin"), "CORS header must be absent");
    expect(response.headers.get("strict-transport-security"), "HSTS header missing");
  });
}

await check("monitoring hides /docs in production", async () => {
  const response = await fetchWithRetry(`${values.monitoring}/docs`);
  expect(response.status === 404, `expected 404, got ${response.status}`);
});

await check("web /api/health is ok", async () => {
  const response = await fetchWithRetry(`${values.web}/api/health`);
  expect(response.status === 200, `status ${response.status}`);
});

await check("web /login has security headers", async () => {
  const response = await fetchWithRetry(`${values.web}/login`);
  expect(response.status === 200, `status ${response.status}`);
  const csp = response.headers.get("content-security-policy") ?? "";
  expect(/script-src 'self' 'nonce-/.test(csp), "nonce-based CSP missing");
  expect(!csp.includes("unsafe-eval"), "unsafe-eval must not be present in production");
  expect(response.headers.get("x-frame-options") === "DENY", "X-Frame-Options missing");
  expect(response.headers.get("strict-transport-security"), "HSTS missing");
  expect(!response.headers.get("x-powered-by"), "X-Powered-By must be removed");
});

await check("web redirects anonymous users to /login", async () => {
  const response = await fetchWithRetry(`${values.web}/dashboard`);
  expect([307, 308].includes(response.status), `status ${response.status}`);
  expect((response.headers.get("location") ?? "").includes("/login"), "not redirected to /login");
});

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
