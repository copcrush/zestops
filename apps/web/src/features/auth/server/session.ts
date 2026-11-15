import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { query } from "@/lib/server/db";
import { getServerEnvironment, isProductionEnvironment } from "@/lib/server/env";
import type { ActiveSession, Role } from "@/types/auth";

/**
 * Server-side sessions.
 *
 * The browser only holds a random 256-bit token in an HttpOnly cookie. The
 * database stores a SHA-256 hash of it, so a database leak does not reveal
 * usable session tokens. Sessions expire after inactivity (idle timeout) and
 * after a fixed maximum lifetime (absolute timeout).
 */

// "__Host-" prefix (production): the browser only accepts the cookie if it is
// Secure, has Path=/ and no Domain, which blocks cookie injection from subdomains.
export function getSessionCookieName(): string {
  return isProductionEnvironment() ? "__Host-zestops_session" : "zestops_session";
}

export const SESSION_COOKIE_NAMES = ["__Host-zestops_session", "zestops_session"] as const;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(sessionToken: string): Buffer {
  return createHash("sha256").update(sessionToken, "utf8").digest();
}

export function getSessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProductionEnvironment(),
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

interface SessionRow {
  session_id: string;
  created_at: Date;
  last_seen_at: Date;
  absolute_expires_at: Date;
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
  last_login_at: Date | null;
}

export async function createSession(userId: string, ipAddress: string | null, userAgent: string | null):
  Promise<{ sessionToken: string; sessionId: string; absoluteExpiresAt: Date }> {
  const environment = getServerEnvironment();
  const sessionToken = generateSessionToken();
  const rows = await query<{ id: string; absolute_expires_at: Date }>(
    `INSERT INTO identity.sessions (user_id, token_hash, idle_expires_at, absolute_expires_at, user_agent, ip_address)
     VALUES ($1, $2, now() + make_interval(mins => $3), now() + make_interval(hours => $4), $5, $6)
     RETURNING id, absolute_expires_at`,
    [userId, hashSessionToken(sessionToken), environment.SESSION_IDLE_TIMEOUT_MINUTES,
      environment.SESSION_ABSOLUTE_TIMEOUT_HOURS, userAgent?.slice(0, 512) ?? null, ipAddress],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Session was not created");
  }
  return { sessionToken, sessionId: row.id, absoluteExpiresAt: row.absolute_expires_at };
}

/** Returns the active session for a token, or null if missing/expired/revoked. */
export async function validateSessionToken(sessionToken: string): Promise<ActiveSession | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
    return null;
  }
  const rows = await query<SessionRow>(
    `SELECT s.id AS session_id, s.created_at, s.last_seen_at, s.absolute_expires_at,
            u.id AS user_id, u.email, u.display_name, u.role, u.last_login_at
     FROM identity.sessions s
     JOIN identity.users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.idle_expires_at > now()
       AND s.absolute_expires_at > now()
       AND u.is_active`,
    [hashSessionToken(sessionToken)],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  // Sliding idle timeout. Updated at most once a minute to limit database writes.
  if (Date.now() - row.last_seen_at.getTime() > 60_000) {
    await query(
      `UPDATE identity.sessions
       SET last_seen_at = now(),
           idle_expires_at = LEAST(now() + make_interval(mins => $2), absolute_expires_at)
       WHERE id = $1`,
      [row.session_id, getServerEnvironment().SESSION_IDLE_TIMEOUT_MINUTES],
    );
  }

  return {
    sessionId: row.session_id,
    createdAt: row.created_at.toISOString(),
    absoluteExpiresAt: row.absolute_expires_at.toISOString(),
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      lastLoginAt: row.last_login_at?.toISOString() ?? null,
    },
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query("DELETE FROM identity.sessions WHERE id = $1", [sessionId]);
}

export async function deleteSessionByToken(sessionToken: string): Promise<void> {
  await query("DELETE FROM identity.sessions WHERE token_hash = $1", [hashSessionToken(sessionToken)]);
}

/** Sign out everywhere except the current browser. Returns how many sessions ended. */
export async function deleteOtherSessions(userId: string, keepSessionId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    "DELETE FROM identity.sessions WHERE user_id = $1 AND id <> $2 RETURNING id",
    [userId, keepSessionId],
  );
  return rows.length;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  isCurrent: boolean;
}

export async function listActiveSessions(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
  const rows = await query<{ id: string; created_at: Date; last_seen_at: Date; user_agent: string | null }>(
    `SELECT id, created_at, last_seen_at, user_agent FROM identity.sessions
     WHERE user_id = $1 AND idle_expires_at > now() AND absolute_expires_at > now()
     ORDER BY last_seen_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    userAgent: row.user_agent,
    isCurrent: row.id === currentSessionId,
  }));
}

/** Housekeeping: remove long-expired sessions and old rate-limit counters. */
export async function deleteExpiredAuthenticationData(): Promise<void> {
  await query(
    `DELETE FROM identity.sessions
     WHERE absolute_expires_at < now() - interval '1 day' OR idle_expires_at < now() - interval '1 day'`,
  );
  await query("DELETE FROM identity.rate_limit_buckets WHERE window_start < now() - interval '1 day'");
}
