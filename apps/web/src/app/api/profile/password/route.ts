import { NextResponse } from "next/server";

import { changePassword } from "@/features/profile/server/profile";
import { getClientIpAddress } from "@/lib/server/request-metadata";
import { errorResponse, parseJsonBody, protectedRoute } from "@/lib/server/route-handler";
import { changePasswordRequestSchema } from "@/lib/shared/validation-schemas";

/** POST /api/profile/password — change password (requires the current password). */
export const POST = protectedRoute({}, async ({ request, session, correlationId }) => {
  const passwords = await parseJsonBody(request, changePasswordRequestSchema);
  const result = await changePassword(session.user.id, session.sessionId, passwords.current_password,
    passwords.new_password, getClientIpAddress(request.headers), correlationId);
  if (!result.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "The current password is incorrect.", correlationId,
      [{ field: "current_password", message: "Current password is incorrect." }]);
  }
  return NextResponse.json({ data: { revoked_sessions: result.revokedSessions } },
    { headers: { "Cache-Control": "no-store" } });
});
