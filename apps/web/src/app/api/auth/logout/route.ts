import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/features/auth/server/audit";
import { deleteSession, getSessionCookieName } from "@/features/auth/server/session";
import { getClientIpAddress } from "@/lib/server/request-metadata";
import { protectedRoute } from "@/lib/server/route-handler";

/** POST /api/auth/logout — revoke the session in the database and clear the cookie. */
export const POST = protectedRoute({}, async ({ request, session, correlationId }) => {
  await deleteSession(session.sessionId);
  await recordAuditEvent("logout", { actorUserId: session.user.id,
    ipAddress: getClientIpAddress(request.headers), requestId: correlationId });

  const response = NextResponse.json({ data: { signed_out: true } }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.delete(getSessionCookieName());
  return response;
});
