export type Role = "admin" | "viewer";

/** The signed-in user, as exposed to pages (no password hash, no lockout fields). */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  lastLoginAt: string | null;
}

export interface ActiveSession {
  sessionId: string;
  user: SessionUser;
  createdAt: string;
  absoluteExpiresAt: string;
}
