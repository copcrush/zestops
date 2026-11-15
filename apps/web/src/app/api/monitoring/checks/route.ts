import { callBackend } from "@/lib/server/backend-client";
import { protectedRoute, relayBackendResponse } from "@/lib/server/route-handler";

/** POST /api/monitoring/checks — check every enabled service now (admin). */
export const POST = protectedRoute({ permission: "runHealthChecks" }, async ({ session, correlationId }) => {
  const backendResponse = await callBackend("monitoring", "/v1/checks/run", session.user, {
    method: "POST", correlationId,
  });
  return relayBackendResponse(backendResponse, correlationId);
});
