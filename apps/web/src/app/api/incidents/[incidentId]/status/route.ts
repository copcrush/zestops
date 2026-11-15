import { callBackend } from "@/lib/server/backend-client";
import { parseJsonBody, protectedRoute, relayBackendResponse, RequestValidationError } from "@/lib/server/route-handler";
import { incidentStatusRequestSchema, uuidSchema } from "@/lib/shared/validation-schemas";

/** POST /api/incidents/{incidentId}/status — investigate or resolve (admin). */
export const POST = protectedRoute<{ incidentId: string }>({ permission: "manageIncidents" },
  async ({ request, session, correlationId }, { incidentId }) => {
    if (!uuidSchema.safeParse(incidentId).success) {
      throw new RequestValidationError([{ field: "incidentId", message: "must be a UUID" }]);
    }
    const statusChange = await parseJsonBody(request, incidentStatusRequestSchema);
    const backendResponse = await callBackend("monitoring", `/v1/incidents/${incidentId}/status`, session.user, {
      method: "POST", jsonBody: statusChange, correlationId,
    });
    return relayBackendResponse(backendResponse, correlationId);
  });
