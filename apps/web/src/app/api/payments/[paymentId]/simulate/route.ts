import { callBackend } from "@/lib/server/backend-client";
import { parseJsonBody, protectedRoute, relayBackendResponse, RequestValidationError } from "@/lib/server/route-handler";
import { simulatePaymentRequestSchema, uuidSchema } from "@/lib/shared/validation-schemas";

/** POST /api/payments/{paymentId}/simulate — run the simulated processing workflow (admin). */
export const POST = protectedRoute<{ paymentId: string }>({ permission: "simulatePayment" },
  async ({ request, session, correlationId }, { paymentId }) => {
    if (!uuidSchema.safeParse(paymentId).success) {
      throw new RequestValidationError([{ field: "paymentId", message: "must be a UUID" }]);
    }
    const simulation = await parseJsonBody(request, simulatePaymentRequestSchema);
    const backendResponse = await callBackend("payment", `/v1/payments/${paymentId}/simulate`, session.user, {
      method: "POST", jsonBody: simulation, correlationId,
    });
    return relayBackendResponse(backendResponse, correlationId);
  });
