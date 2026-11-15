/**
 * Integration tests for login, sessions and lockout against a real PostgreSQL
 * test database (identity schema, as the zestops_web_app role).
 * Needs TEST_DATABASE_URL (from .env.local or the environment).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

function loadLocalEnvironment(): void {
  try {
    const envFile = readFileSync(resolve(__dirname, "../../.env.local"), "utf8");
    for (const line of envFile.split("\n")) {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex > 0 && !line.startsWith("#")) {
        const name = line.slice(0, separatorIndex).trim();
        process.env[name] ??= line.slice(separatorIndex + 1).trim();
      }
    }
  } catch {
    // CI provides variables directly.
  }
}

loadLocalEnvironment();
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const shouldRun = Boolean(testDatabaseUrl);
if (!shouldRun && process.env.REQUIRE_INTEGRATION_TESTS === "true") {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}
if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.LOGIN_ATTEMPTS_PER_IP_PER_WINDOW = "3";
}

const TEST_EMAIL = "lockout.user@integration.test";
const TEST_PASSWORD = "correct horse battery staple";

describe.runIf(shouldRun)("authentication against PostgreSQL", async () => {
  const { query, getDatabasePool } = await import("@/lib/server/db");
  const { hashPassword } = await import("@/features/auth/server/password");
  const { loginWithPassword, MAXIMUM_FAILED_LOGINS } = await import("@/features/auth/server/login");
  const { validateSessionToken, deleteSession, deleteOtherSessions, createSession, hashSessionToken } =
    await import("@/features/auth/server/session");

  let userId: string;

  async function resetIdentityData(): Promise<void> {
    await query("DELETE FROM identity.rate_limit_buckets");
    await query("DELETE FROM identity.users WHERE email LIKE '%@integration.test'");
    const rows = await query<{ id: string }>(
      `INSERT INTO identity.users (email, display_name, password_hash, role)
       VALUES ($1, 'Integration User', $2, 'viewer') RETURNING id`,
      [TEST_EMAIL, await hashPassword(TEST_PASSWORD)],
    );
    userId = rows[0]!.id;
  }

  beforeAll(resetIdentityData);
  beforeEach(resetIdentityData);
  afterAll(async () => {
    await query("DELETE FROM identity.users WHERE email LIKE '%@integration.test'");
    await query("DELETE FROM identity.rate_limit_buckets");
    await getDatabasePool().end();
  });

  it("logs in with correct credentials and stores only a hash of the session token", async () => {
    const result = await loginWithPassword(TEST_EMAIL.toUpperCase(), TEST_PASSWORD, "203.0.113.10", "vitest", "req-1");
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;

    const session = await validateSessionToken(result.sessionToken);
    expect(session?.user.id).toBe(userId);
    expect(session?.user.role).toBe("viewer");

    const storedRows = await query<{ token_hash: Buffer }>("SELECT token_hash FROM identity.sessions WHERE user_id = $1", [userId]);
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]!.token_hash.equals(hashSessionToken(result.sessionToken))).toBe(true);
    expect(storedRows[0]!.token_hash.toString("utf8")).not.toContain(result.sessionToken);
  });

  it("returns the same answer for unknown e-mail and wrong password", async () => {
    const unknownUser = await loginWithPassword("nobody@integration.test", TEST_PASSWORD, "203.0.113.11", null, "req-2");
    const wrongPassword = await loginWithPassword(TEST_EMAIL, "wrong password", "203.0.113.12", null, "req-3");
    expect(unknownUser).toEqual({ outcome: "invalid_credentials" });
    expect(wrongPassword).toEqual({ outcome: "invalid_credentials" });
  });

  it("locks the account after repeated failures, even for the correct password", async () => {
    for (let attempt = 1; attempt <= MAXIMUM_FAILED_LOGINS; attempt++) {
      // Different IPs so the per-IP limit does not interfere with this test.
      await loginWithPassword(TEST_EMAIL, `wrong-${attempt}`, `198.51.100.${attempt}`, null, `req-lock-${attempt}`);
    }
    const lockedRows = await query<{ locked: boolean }>(
      "SELECT locked_until > now() AS locked FROM identity.users WHERE id = $1", [userId]);
    expect(lockedRows[0]!.locked).toBe(true);

    const correctPasswordWhileLocked = await loginWithPassword(TEST_EMAIL, TEST_PASSWORD, "198.51.100.99", null, "req-locked");
    expect(correctPasswordWhileLocked.outcome).toBe("invalid_credentials");

    const auditRows = await query<{ count: string }>(
      "SELECT count(*) FROM identity.audit_events WHERE actor_user_id = $1 AND event_type = 'account_locked'", [userId]);
    expect(Number(auditRows[0]!.count)).toBe(1);
  });

  it("rate-limits sign-in attempts per IP address", async () => {
    const outcomes = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      outcomes.push((await loginWithPassword(TEST_EMAIL, "wrong", "192.0.2.50", null, `req-rate-${attempt}`)).outcome);
    }
    expect(outcomes.slice(0, 3)).toEqual(["invalid_credentials", "invalid_credentials", "invalid_credentials"]);
    expect(outcomes.slice(3)).toEqual(["rate_limited", "rate_limited"]);
  });

  it("rejects expired, deleted and malformed session tokens", async () => {
    const session = await createSession(userId, null, null);
    expect(await validateSessionToken(session.sessionToken)).not.toBeNull();

    await query("UPDATE identity.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1", [session.sessionId]);
    expect(await validateSessionToken(session.sessionToken)).toBeNull();

    const secondSession = await createSession(userId, null, null);
    await deleteSession(secondSession.sessionId);
    expect(await validateSessionToken(secondSession.sessionToken)).toBeNull();

    expect(await validateSessionToken("not-a-token")).toBeNull();
    expect(await validateSessionToken("x".repeat(43))).toBeNull();
  });

  it("disabled users cannot use existing sessions", async () => {
    const session = await createSession(userId, null, null);
    await query("UPDATE identity.users SET is_active = false WHERE id = $1", [userId]);
    expect(await validateSessionToken(session.sessionToken)).toBeNull();
  });

  it("signs out other sessions but keeps the current one", async () => {
    const current = await createSession(userId, null, null);
    const other = await createSession(userId, null, null);
    expect(await deleteOtherSessions(userId, current.sessionId)).toBe(1);
    expect(await validateSessionToken(current.sessionToken)).not.toBeNull();
    expect(await validateSessionToken(other.sessionToken)).toBeNull();
  });
});
