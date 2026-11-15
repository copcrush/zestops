import { callBackend } from "@/lib/server/backend-client";
import { parseJsonBody, protectedRoute, relayBackendResponse } from "@/lib/server/route-handler";
import { registerServiceRequestSchema } from "@/lib/shared/validation-schemas";

/** POST /api/monitoring/services — register an approved service (admin). The allowlist is enforced by the backend. */
export const POST = protectedRoute({ permission: "manageMonitoredServices" },
  async ({ request, session, correlationId }) => {
    const service = await parseJsonBody(request, registerServiceRequestSchema);
    const backendResponse = await callBackend("monitoring", "/v1/services", session.user, {
      method: "POST", jsonBody: service, correlationId,
    });
    return relayBackendResponse(backendResponse, correlationId);
  });
