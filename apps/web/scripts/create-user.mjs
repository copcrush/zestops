#!/usr/bin/env node
/**
 * Create (or update the password of) a ZestOps user in the identity schema.
 * Use this for any environment instead of the local-only SQL seed.
 *
 *   NEW_USER_PASSWORD='a long passphrase' npm run users:create -- \
 *     --email ops@example.com --name "Ops Admin" --role admin
 *
 * The password is read from the NEW_USER_PASSWORD environment variable so it
 * never appears in shell history as a command argument. DATABASE_URL must point
 * at the target database (the zestops_web_app role is sufficient).
 */
import { parseArgs } from "node:util";

import { hash } from "@node-rs/argon2";
import pg from "pg";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "viewer" } },
});
const password = process.env.NEW_USER_PASSWORD ?? "";

const problems = [];
if (!values.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) problems.push("--email is required");
if (!values.name || values.name.length > 80) problems.push("--name is required (max 80 characters)");
if (!["admin", "viewer"].includes(values.role ?? "")) problems.push("--role must be admin or viewer");
if (password.length < 12 || password.length > 128) problems.push("NEW_USER_PASSWORD must be 12-128 characters");
if (!process.env.DATABASE_URL) problems.push("DATABASE_URL is required");
if (problems.length > 0) {
  console.error(`Cannot create user:\n - ${problems.join("\n - ")}`);
  process.exit(1);
}

// Same argon2id parameters as src/features/auth/server/password.ts (2 = Argon2id).
const passwordHash = await hash(password, { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query(
    `INSERT INTO identity.users (email, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (lower(email)) DO UPDATE
       SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
           failed_login_count = 0, locked_until = NULL, password_changed_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [values.email, values.name, passwordHash, values.role],
  );
  const row = result.rows[0];
  console.log(`${row.inserted ? "Created" : "Updated"} ${values.role} user ${values.email} (${row.id}).`);
} finally {
  await client.end();
}
