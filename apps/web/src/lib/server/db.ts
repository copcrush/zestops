import "server-only";

import { Pool, type QueryResultRow } from "pg";

import { getServerEnvironment } from "@/lib/server/env";

/**
 * PostgreSQL connection pool for the `identity` schema (users, sessions, audit).
 * The web app connects as `zestops_web_app`, which can only touch that schema.
 *
 * In development, Next.js reloads modules often; keeping the pool on globalThis
 * prevents opening a new pool (and new connections) on every reload.
 */
const globalForDatabase = globalThis as unknown as { zestopsDatabasePool?: Pool };

function createPool(): Pool {
  const pool = new Pool({
    connectionString: getServerEnvironment().DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (error) => {
    console.error(JSON.stringify({ level: "error", msg: "idle database client error", error: error.message }));
  });
  return pool;
}

export function getDatabasePool(): Pool {
  globalForDatabase.zestopsDatabasePool ??= createPool();
  return globalForDatabase.zestopsDatabasePool;
}

/** Run a parameterized query. Values are always sent separately from the SQL text. */
export async function query<Row extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<Row[]> {
  const result = await getDatabasePool().query<Row>(sql, values);
  return result.rows;
}
