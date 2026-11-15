import { callBackend } from "@/lib/server/backend-client";
import { protectedRoute, relayBackendResponse, RequestValidationError } from "@/lib/server/route-handler";
import { uuidSchema } from "@/lib/shared/validation-schemas";

/** POST /api/payments/{paymentId}/cancel — cancel a pending payment (admin). */
export const POST = protectedRoute<{ paymentId: string }>({ permission: "cancelPayment" },
  async ({ session, correlationId }, { paymentId }) => {
    if (!uuidSchema.safeParse(paymentId).success) {
      throw new RequestValidationError([{ field: "paymentId", message: "must be a UUID" }]);
    }
    const backendResponse = await callBackend("payment", `/v1/payments/${paymentId}/cancel`, session.user, {
      method: "POST", correlationId,
    });
    return relayBackendResponse(backendResponse, correlationId);
  });
