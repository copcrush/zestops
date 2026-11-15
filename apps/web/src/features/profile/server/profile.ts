import "server-only";

import { recordAuditEvent } from "@/features/auth/server/audit";
import { hashPassword, verifyPassword } from "@/features/auth/server/password";
import { deleteOtherSessions } from "@/features/auth/server/session";
import { query } from "@/lib/server/db";

export async function updateDisplayName(userId: string, displayName: string, requestId: string): Promise<void> {
  await query("UPDATE identity.users SET display_name = $2 WHERE id = $1", [userId, displayName]);
  await recordAuditEvent("profile_updated", { actorUserId: userId, requestId, details: { field: "display_name" } });
}

export type ChangePasswordResult = { ok: true; revokedSessions: number } | { ok: false; reason: "wrong_password" };

/**
 * Change the password after re-verifying the current one. All OTHER sessions
 * are revoked, so a stolen session elsewhere stops working immediately.
 */
export async function changePassword(userId: string, currentSessionId: string, currentPassword: string,
                                     newPassword: string, ipAddress: string | null, requestId: string):
  Promise<ChangePasswordResult> {
  const rows = await query<{ password_hash: string }>("SELECT password_hash FROM identity.users WHERE id = $1",
    [userId]);
  const storedHash = rows[0]?.password_hash;
  if (!storedHash || !(await verifyPassword(storedHash, currentPassword))) {
    await recordAuditEvent("password_change_failed", { actorUserId: userId, ipAddress, requestId });
    return { ok: false, reason: "wrong_password" };
  }

  await query("UPDATE identity.users SET password_hash = $2, password_changed_at = now() WHERE id = $1",
    [userId, await hashPassword(newPassword)]);
  const revokedSessions = await deleteOtherSessions(userId, currentSessionId);
  await recordAuditEvent("password_changed", { actorUserId: userId, ipAddress, requestId,
    details: { revoked_sessions: revokedSessions } });
  return { ok: true, revokedSessions };
}
