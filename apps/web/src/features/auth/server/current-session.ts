import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { hasPermission, type Permission } from "@/features/auth/permissions";
import type { ActiveSession } from "@/types/auth";

import { getSessionCookieName, validateSessionToken } from "./session";

/**
 * Data Access Layer for authentication (used by Server Components).
 * `cache` makes the session lookup happen once per request, even if many
 * components ask for it.
 */
export const getCurrentSession = cache(async (): Promise<ActiveSession | null> => {
  const sessionToken = (await cookies()).get(getSessionCookieName())?.value;
  if (!sessionToken) {
    return null;
  }
  return validateSessionToken(sessionToken);
});

/** Use in pages/layouts that need a signed-in user. Redirects to /login otherwise. */
export async function requireSession(): Promise<ActiveSession> {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/** Use in pages that need a specific permission. Redirects to /unauthorized otherwise. */
export async function requirePermission(permission: Permission): Promise<ActiveSession> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, permission)) {
    redirect("/unauthorized");
  }
  return session;
}
