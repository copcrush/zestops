import { callBackend } from "@/lib/server/backend-client";
import { parseJsonBody, protectedRoute, relayBackendResponse, RequestValidationError } from "@/lib/server/route-handler";
import { updateServiceRequestSchema, uuidSchema } from "@/lib/shared/validation-schemas";

/** PATCH /api/monitoring/services/{serviceId} — enable/disable or tune a service (admin). */
export const PATCH = protectedRoute<{ serviceId: string }>({ permission: "manageMonitoredServices" },
  async ({ request, session, correlationId }, { serviceId }) => {
    if (!uuidSchema.safeParse(serviceId).success) {
      throw new RequestValidationError([{ field: "serviceId", message: "must be a UUID" }]);
    }
    const changes = await parseJsonBody(request, updateServiceRequestSchema);
    const backendResponse = await callBackend("monitoring", `/v1/services/${serviceId}`, session.user, {
      method: "PATCH", jsonBody: changes, correlationId,
    });
    return relayBackendResponse(backendResponse, correlationId);
  });
