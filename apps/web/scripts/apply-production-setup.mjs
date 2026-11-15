#!/usr/bin/env node
/**
 * Apply STEP A (bootstrap) or STEP C (users) from .secrets/production-setup.txt using
 * EXACTLY the same connection string as the GitHub "Database migrate" secret.
 * This avoids picking the wrong branch/database in a web SQL editor.
 *
 *   npm run setup:production:apply -- A     # before the migrate workflow
 *   npm run setup:production:apply -- C     # after the migrate workflow is green
 *
 * Prints only non-secret facts (database name, counts, user e-mails and roles).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const setupFile = join(repositoryRoot, ".secrets", "production-setup.txt");
const step = (process.argv[2] ?? "").toUpperCase();
const SEPARATOR = "=".repeat(78);
const BOOTSTRAP_SCHEMAS = ["identity", "payments", "monitoring", "zestops_migrations"];

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (step !== "A" && step !== "C") {
  fail("Tell me which step to run: npm run setup:production:apply -- A   (or C)");
}

let setupText;
try {
  setupText = readFileSync(setupFile, "utf8");
} catch {
  fail(`Cannot read ${setupFile}. Run "npm run setup:production" first (it creates this file).`);
}

const ownerUrl = /^Value: (\S+)/m.exec(setupText)?.[1];
if (!ownerUrl) {
  fail("Could not find the owner connection string (the 'Value:' line of STEP B) in the setup file.");
}

const parts = setupText.split(SEPARATOR);
const headerIndex = parts.findIndex((part) => part.includes(`STEP ${step}`));
if (headerIndex < 0 || !parts[headerIndex + 1]) {
  fail(`Could not find the STEP ${step} SQL block in the setup file.`);
}
const sql = parts[headerIndex + 1];

const client = new pg.Client({ connectionString: ownerUrl });

async function countBootstrapSchemas() {
  const result = await client.query(
    "SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = ANY($1)", [BOOTSTRAP_SCHEMAS]);
  return result.rows[0].count;
}

async function hasUsersTable() {
  const result = await client.query("SELECT to_regclass('identity.users') IS NOT NULL AS exists");
  return result.rows[0].exists;
}

try {
  await client.connect();
  const { rows } = await client.query("SELECT current_database() AS database_name");
  console.log(`Connected to database "${rows[0].database_name}" (same connection as the GitHub secret).`);

  if (step === "C" && !(await hasUsersTable())) {
    fail("Table identity.users does not exist yet. Run the 'Database migrate' workflow (command: up) first.");
  }

  // One transaction: either everything in the step is applied, or nothing is.
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");

  if (step === "A") {
    const schemaCount = await countBootstrapSchemas();
    console.log(`✓ STEP A done: ${schemaCount} of ${BOOTSTRAP_SCHEMAS.length} schemas exist.`);
    console.log("Next: GitHub > Actions > Database migrate > Run workflow (branch main, production, up).");
  } else {
    const users = await client.query("SELECT email, role FROM identity.users ORDER BY role, email");
    console.log("✓ STEP C done. Users:");
    for (const user of users.rows) {
      console.log(`  - ${user.email} (${user.role})`);
    }
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  fail(`STEP ${step} failed and nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await client.end().catch(() => {});
}
