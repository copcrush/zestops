import { callBackend } from "@/lib/server/backend-client";
import { parseJsonBody, protectedRoute, relayBackendResponse } from "@/lib/server/route-handler";
import { createPaymentRequestSchema } from "@/lib/shared/validation-schemas";

/** POST /api/payments — create a simulated payment (admin). */
export const POST = protectedRoute({ permission: "createPayment" }, async ({ request, session, correlationId }) => {
  const { idempotency_key: idempotencyKey, ...paymentFields } = await parseJsonBody(request,
    createPaymentRequestSchema);
  const backendResponse = await callBackend("payment", "/v1/payments", session.user, {
    method: "POST", jsonBody: paymentFields, idempotencyKey, correlationId,
  });
  return relayBackendResponse(backendResponse, correlationId);
});
