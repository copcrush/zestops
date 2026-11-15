import "server-only";

import { query } from "@/lib/server/db";
import { logger } from "@/lib/server/logger";

export type AuditEventType =
  | "login_succeeded"
  | "login_failed"
  | "login_rate_limited"
  | "account_locked"
  | "logout"
  | "password_changed"
  | "password_change_failed"
  | "profile_updated"
  | "other_sessions_revoked"
  | "access_denied"
  | "csrf_rejected"
  | "demo_login_succeeded"
  | "demo_login_rejected";

/**
 * Write a security audit event (database + structured log).
 * Never include passwords, tokens or full request bodies in `details`.
 */
export async function recordAuditEvent(eventType: AuditEventType, options: {
  actorUserId?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
  details?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  logger.info("audit event", { event_type: eventType, user_id: options.actorUserId ?? null,
    request_id: options.requestId ?? null, ...options.details });
  try {
    await query(
      `INSERT INTO identity.audit_events (event_type, actor_user_id, ip_address, request_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [eventType, options.actorUserId ?? null, options.ipAddress ?? null, options.requestId ?? null,
        JSON.stringify(options.details ?? {})],
    );
  } catch (error) {
    // Auditing must never break the user's request; the log line above still exists.
    logger.error("failed to store audit event", { event_type: eventType, error: String(error) });
  }
}

export interface AuditEventRow {
  id: string;
  occurredAt: string;
  eventType: AuditEventType;
  actorUserId: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
  details: Record<string, unknown>;
}

export async function listRecentAuditEvents(limit = 100): Promise<AuditEventRow[]> {
  const rows = await query<{ id: string; occurred_at: Date; event_type: AuditEventType; actor_user_id: string | null;
    email: string | null; ip_address: string | null; details: Record<string, unknown> }>(
    `SELECT a.id, a.occurred_at, a.event_type, a.actor_user_id, u.email, host(a.ip_address) AS ip_address, a.details
     FROM identity.audit_events a
     LEFT JOIN identity.users u ON u.id = a.actor_user_id
     ORDER BY a.occurred_at DESC, a.id DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: String(row.id), occurredAt: row.occurred_at.toISOString(), eventType: row.event_type,
    actorUserId: row.actor_user_id, actorEmail: row.email, ipAddress: row.ip_address, details: row.details,
  }));
}
