import { callBackend } from "@/lib/server/backend-client";
import { parseJsonBody, protectedRoute, relayBackendResponse, RequestValidationError } from "@/lib/server/route-handler";
import { incidentNoteRequestSchema, uuidSchema } from "@/lib/shared/validation-schemas";

/** POST /api/incidents/{incidentId}/notes — add an investigation note (admin). */
export const POST = protectedRoute<{ incidentId: string }>({ permission: "manageIncidents" },
  async ({ request, session, correlationId }, { incidentId }) => {
    if (!uuidSchema.safeParse(incidentId).success) {
      throw new RequestValidationError([{ field: "incidentId", message: "must be a UUID" }]);
    }
    const note = await parseJsonBody(request, incidentNoteRequestSchema);
    const backendResponse = await callBackend("monitoring", `/v1/incidents/${incidentId}/notes`, session.user, {
      method: "POST", jsonBody: note, correlationId,
    });
    return relayBackendResponse(backendResponse, correlationId);
  });
