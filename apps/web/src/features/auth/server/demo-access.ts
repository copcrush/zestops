import "server-only";

import { query } from "@/lib/server/db";
import { getServerEnvironment } from "@/lib/server/env";

import { recordAuditEvent } from "./audit";
import { consumeRateLimit } from "./rate-limit";
import { createSession } from "./session";

/**
 * Public read-only demo ("Explore as guest").
 *
 * Visitors get a session for one pre-created VIEWER account without ever seeing
 * its password. Safety rules:
 *  - only works if PUBLIC_DEMO_VIEWER_EMAIL is configured
 *  - the account must have role "viewer" (never admin), checked on every login
 *  - rate limited per IP
 *  - the demo account cannot change its profile, password or other sessions
 *    (see isDemoAccount), so one visitor cannot lock others out
 */
const DEMO_LOGINS_PER_IP = 30;
const DEMO_WINDOW_SECONDS = 15 * 60;

export function isPublicDemoEnabled(): boolean {
  return Boolean(getServerEnvironment().PUBLIC_DEMO_VIEWER_EMAIL);
}

export function isDemoAccount(email: string): boolean {
  const demoEmail = getServerEnvironment().PUBLIC_DEMO_VIEWER_EMAIL;
  return Boolean(demoEmail) && email.toLowerCase() === demoEmail?.toLowerCase();
}

export type DemoLoginResult =
  | { outcome: "success"; sessionToken: string; absoluteExpiresAt: Date }
  | { outcome: "disabled" }
  | { outcome: "rate_limited" };

export async function startDemoSession(ipAddress: string | null, userAgent: string | null, requestId: string):
  Promise<DemoLoginResult> {
  const demoEmail = getServerEnvironment().PUBLIC_DEMO_VIEWER_EMAIL;
  if (!demoEmail) {
    return { outcome: "disabled" };
  }
  if (!(await consumeRateLimit(`demo:ip:${ipAddress ?? "unknown"}`, DEMO_LOGINS_PER_IP, DEMO_WINDOW_SECONDS))) {
    return { outcome: "rate_limited" };
  }

  const rows = await query<{ id: string }>(
    "SELECT id FROM identity.users WHERE lower(email) = lower($1) AND role = 'viewer' AND is_active",
    [demoEmail],
  );
  const demoUser = rows[0];
  if (!demoUser) {
    // Misconfiguration (missing account, or someone pointed it at an admin): refuse.
    await recordAuditEvent("demo_login_rejected", { ipAddress, requestId, details: { reason: "not_a_viewer" } });
    return { outcome: "disabled" };
  }

  const session = await createSession(demoUser.id, ipAddress, userAgent);
  await recordAuditEvent("demo_login_succeeded", { actorUserId: demoUser.id, ipAddress, requestId });
  return { outcome: "success", sessionToken: session.sessionToken, absoluteExpiresAt: session.absoluteExpiresAt };
}
