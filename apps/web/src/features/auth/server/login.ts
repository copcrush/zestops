import "server-only";

import { query } from "@/lib/server/db";
import { getServerEnvironment } from "@/lib/server/env";
import type { Role } from "@/types/auth";

import { recordAuditEvent } from "./audit";
import { burnPasswordVerificationTime, verifyPassword } from "./password";
import { consumeRateLimit } from "./rate-limit";
import { createSession, deleteExpiredAuthenticationData } from "./session";

export const MAXIMUM_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
const LOGIN_WINDOW_SECONDS = 15 * 60;

export type LoginResult =
  | { outcome: "success"; sessionToken: string; absoluteExpiresAt: Date; userId: string; role: Role }
  | { outcome: "invalid_credentials" }
  | { outcome: "rate_limited" };

interface UserCredentialRow {
  id: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  is_locked: boolean;
}

/**
 * Verify an e-mail + password and start a session.
 *
 * Protections:
 * - per-IP rate limit (shared across instances, stored in PostgreSQL)
 * - per-account lockout after MAXIMUM_FAILED_LOGINS failures
 * - the same generic answer for "no such user", "wrong password", "locked" and
 *   "disabled", plus constant-ish timing, to prevent user enumeration
 * - a brand-new session on every login (prevents session fixation)
 */
export async function loginWithPassword(email: string, password: string, ipAddress: string | null,
                                        userAgent: string | null, requestId: string): Promise<LoginResult> {
  const rateLimitKey = `login:ip:${ipAddress ?? "unknown"}`;
  const attemptsPerWindow = getServerEnvironment().LOGIN_ATTEMPTS_PER_IP_PER_WINDOW;
  if (!(await consumeRateLimit(rateLimitKey, attemptsPerWindow, LOGIN_WINDOW_SECONDS))) {
    await recordAuditEvent("login_rate_limited", { ipAddress, requestId });
    return { outcome: "rate_limited" };
  }

  const rows = await query<UserCredentialRow>(
    `SELECT id, password_hash, role, is_active, (locked_until IS NOT NULL AND locked_until > now()) AS is_locked
     FROM identity.users WHERE lower(email) = lower($1)`,
    [email],
  );
  const user = rows[0];

  if (!user) {
    await burnPasswordVerificationTime(password);
    await recordAuditEvent("login_failed", { ipAddress, requestId, details: { reason: "unknown_email" } });
    return { outcome: "invalid_credentials" };
  }

  const isPasswordCorrect = await verifyPassword(user.password_hash, password);

  if (!user.is_active || user.is_locked) {
    await recordAuditEvent("login_failed", { actorUserId: user.id, ipAddress, requestId,
      details: { reason: user.is_locked ? "account_locked" : "account_disabled" } });
    return { outcome: "invalid_credentials" };
  }

  if (!isPasswordCorrect) {
    await registerFailedLogin(user.id, ipAddress, requestId);
    return { outcome: "invalid_credentials" };
  }

  await query(
    `UPDATE identity.users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
    [user.id],
  );
  await deleteExpiredAuthenticationData();
  const session = await createSession(user.id, ipAddress, userAgent);
  await recordAuditEvent("login_succeeded", { actorUserId: user.id, ipAddress, requestId });
  return { outcome: "success", sessionToken: session.sessionToken, absoluteExpiresAt: session.absoluteExpiresAt,
    userId: user.id, role: user.role };
}

async function registerFailedLogin(userId: string, ipAddress: string | null, requestId: string): Promise<void> {
  // One atomic UPDATE, so parallel wrong guesses cannot skip the lockout.
  const rows = await query<{ failed_login_count: number; locked: boolean }>(
    `UPDATE identity.users
     SET failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
         locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3)
                             ELSE locked_until END
     WHERE id = $1
     RETURNING failed_login_count, (locked_until IS NOT NULL AND locked_until > now()) AS locked`,
    [userId, MAXIMUM_FAILED_LOGINS, LOCKOUT_MINUTES],
  );
  const wasLocked = rows[0]?.locked ?? false;
  await recordAuditEvent(wasLocked ? "account_locked" : "login_failed", {
    actorUserId: userId, ipAddress, requestId, details: { reason: "wrong_password" },
  });
}
