"use client";

import { createContext, type ReactNode, use } from "react";

import type { SessionUser } from "@/types/auth";

/**
 * Makes the signed-in user and the CSRF token available to Client Components.
 * The session token itself is NEVER here: it stays in an HttpOnly cookie that
 * JavaScript cannot read.
 */
interface SessionContextValue {
  user: SessionUser;
  csrfToken: string;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ user, csrfToken, children }: SessionContextValue & { children: ReactNode }) {
  return <SessionContext value={{ user, csrfToken }}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const session = use(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return session;
}
