import "server-only";

import { errorResponse } from "@/lib/server/route-handler";

/** The shared guest account must stay usable for every visitor, so it cannot be modified. */
export function demoAccountReadOnlyResponse(correlationId: string): Response {
  return errorResponse(403, "DEMO_ACCOUNT_READ_ONLY",
    "The shared guest account cannot change its profile, password or sessions.", correlationId);
}
