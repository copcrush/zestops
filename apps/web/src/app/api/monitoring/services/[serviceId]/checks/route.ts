import { callBackend } from "@/lib/server/backend-client";
import { protectedRoute, relayBackendResponse, RequestValidationError } from "@/lib/server/route-handler";
import { uuidSchema } from "@/lib/shared/validation-schemas";

/** POST /api/monitoring/services/{serviceId}/checks — check one service now (admin). */
export const POST = protectedRoute<{ serviceId: string }>({ permission: "runHealthChecks" },
  async ({ session, correlationId }, { serviceId }) => {
    if (!uuidSchema.safeParse(serviceId).success) {
      throw new RequestValidationError([{ field: "serviceId", message: "must be a UUID" }]);
    }
    const backendResponse = await callBackend("monitoring", `/v1/services/${serviceId}/checks`, session.user, {
      method: "POST", correlationId,
    });
    return relayBackendResponse(backendResponse, correlationId);
  });
