import { demoAccountReadOnlyResponse } from "@/features/profile/server/demo-guard";
import { isDemoAccount } from "@/features/auth/server/demo-access";
import { NextResponse } from "next/server";

import { updateDisplayName } from "@/features/profile/server/profile";
import { parseJsonBody, protectedRoute } from "@/lib/server/route-handler";
import { updateProfileRequestSchema } from "@/lib/shared/validation-schemas";

/** PATCH /api/profile — change the signed-in user's display name. */
export const PATCH = protectedRoute({}, async ({ request, session, correlationId }) => {
  if (isDemoAccount(session.user.email)) {
    return demoAccountReadOnlyResponse(correlationId);
  }
  const { display_name: displayName } = await parseJsonBody(request, updateProfileRequestSchema);
  await updateDisplayName(session.user.id, displayName, correlationId);
  return NextResponse.json({ data: { display_name: displayName } }, { headers: { "Cache-Control": "no-store" } });
});
