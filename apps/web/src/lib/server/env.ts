import "server-only";

import { z } from "zod";

/**
 * Server-side environment variables, validated once on first use.
 * A missing or malformed value fails loudly with the variable name, instead of
 * causing confusing errors later. Values are never sent to the browser.
 */
const environmentSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().startsWith("postgres"),
  PAYMENT_API_BASE_URL: z.url(),
  MONITORING_API_BASE_URL: z.url(),
  CSRF_SECRET: z.string().min(32, "CSRF_SECRET must be at least 32 characters"),
  INTERNAL_JWT_ISSUER: z.string().min(1).default("zestops-web"),
  INTERNAL_JWT_KEY_ID: z.string().min(1),
  INTERNAL_JWT_PRIVATE_KEY_BASE64: z.string().min(40),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(1).max(7 * 24).default(8),
  // Sign-in attempts allowed per client IP per 15 minutes (raise only for local E2E testing).
  LOGIN_ATTEMPTS_PER_IP_PER_WINDOW: z.coerce.number().int().min(1).max(10_000).default(20),
});

export type ServerEnvironment = z.infer<typeof environmentSchema>;

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }
  const parsed = environmentSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment variables: ${problems}`);
  }
  cachedEnvironment = parsed.data;
  return cachedEnvironment;
}

export function isProductionEnvironment(): boolean {
  return getServerEnvironment().APP_ENV === "production";
}
