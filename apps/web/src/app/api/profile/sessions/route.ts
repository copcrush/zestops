import { demoAccountReadOnlyResponse } from "@/features/profile/server/demo-guard";
import { isDemoAccount } from "@/features/auth/server/demo-access";
import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/features/auth/server/audit";
import { deleteOtherSessions } from "@/features/auth/server/session";
import { protectedRoute } from "@/lib/server/route-handler";

/** DELETE /api/profile/sessions — sign out every other browser/device. */
export const DELETE = protectedRoute({}, async ({ session, correlationId }) => {
  if (isDemoAccount(session.user.email)) {
    return demoAccountReadOnlyResponse(correlationId);
  }
  const revokedSessions = await deleteOtherSessions(session.user.id, session.sessionId);
  await recordAuditEvent("other_sessions_revoked", { actorUserId: session.user.id, requestId: correlationId,
    details: { revoked_sessions: revokedSessions } });
  return NextResponse.json({ data: { revoked_sessions: revokedSessions } },
    { headers: { "Cache-Control": "no-store" } });
});
