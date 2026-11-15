import { callBackend } from "@/lib/server/backend-client";
import { parseJsonBody, protectedRoute, relayBackendResponse } from "@/lib/server/route-handler";
import { createIncidentRequestSchema } from "@/lib/shared/validation-schemas";

/** POST /api/incidents — report an incident (admin). */
export const POST = protectedRoute({ permission: "manageIncidents" }, async ({ request, session, correlationId }) => {
  const incident = await parseJsonBody(request, createIncidentRequestSchema);
  const backendResponse = await callBackend("monitoring", "/v1/incidents", session.user, {
    method: "POST", jsonBody: { ...incident, service_id: incident.service_id ?? null }, correlationId,
  });
  return relayBackendResponse(backendResponse, correlationId);
});
