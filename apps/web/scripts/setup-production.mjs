#!/usr/bin/env node
/**
 * One-time PRODUCTION setup helper. Run on YOUR computer (never in CI, never in chat):
 *
 *   cd apps/web
 *   npm install
 *   npm run setup:production
 *
 * It asks three questions (Neon owner connection string, admin e-mail, admin name),
 * generates every production secret, and writes a step-by-step file:
 *
 *   .secrets/production-setup.txt   (git-ignored)
 *
 * containing: SQL to paste into the Neon SQL Editor, the GitHub secret, and the exact
 * environment variables for Render and Vercel. Copy them into a password manager, then
 * delete the file.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { hash } from "@node-rs/argon2";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outputDirectory = join(repositoryRoot, ".secrets");
const outputFile = join(outputDirectory, "production-setup.txt");
const shouldOverwrite = process.argv.includes("--force");

const GUEST_EMAIL = "guest@zestops.demo";
const PAYMENT_API_URL = "https://zestops-payment-api.onrender.com";
const MONITORING_API_URL = "https://zestops-monitoring-api.onrender.com";

function randomSecret(byteLength = 24) {
  return randomBytes(byteLength).toString("base64url");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function hashPassword(password) {
  // Same parameters as src/features/auth/server/password.ts (algorithm 2 = Argon2id).
  return hash(password, { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });
}

/** Neon's pooled (PgBouncer) host is the endpoint id + "-pooler". */
function toPooledHost(hostname) {
  const [firstLabel, ...rest] = hostname.split(".");
  if (!firstLabel?.startsWith("ep-") || firstLabel.endsWith("-pooler")) {
    return hostname;
  }
  return [`${firstLabel}-pooler`, ...rest].join(".");
}

function toDirectHost(hostname) {
  const [firstLabel, ...rest] = hostname.split(".");
  return [firstLabel.replace(/-pooler$/, ""), ...rest].join(".");
}

async function askQuestions() {
  const answers = {
    ownerUrl: process.env.ZESTOPS_NEON_OWNER_URL,
    adminEmail: process.env.ZESTOPS_ADMIN_EMAIL,
    adminName: process.env.ZESTOPS_ADMIN_NAME,
  };
  if (answers.ownerUrl && answers.adminEmail && answers.adminName) {
    return answers;
  }
  const prompt = createInterface({ input, output });
  console.log("\nZestOps production setup — 3 questions.\n");
  answers.ownerUrl ??= (await prompt.question(
    "1) Paste the Neon connection string (Neon dashboard > Connect, role neondb_owner):\n> ")).trim();
  answers.adminEmail ??= (await prompt.question("2) Your admin e-mail (used to sign in to ZestOps):\n> ")).trim();
  answers.adminName ??= (await prompt.question("3) Your display name [ZestOps Admin]:\n> ")).trim() || "ZestOps Admin";
  prompt.close();
  return answers;
}

function parseOwnerUrl(ownerUrl) {
  let parsed;
  try {
    parsed = new URL(ownerUrl);
  } catch {
    throw new Error("That does not look like a connection string (expected postgresql://user:password@host/db...).");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("The connection string must start with postgresql:// or postgres://");
  }
  if (!parsed.username || !parsed.password || !parsed.hostname) {
    throw new Error("The connection string must contain a user, a password and a host.");
  }
  return {
    ownerUser: decodeURIComponent(parsed.username),
    ownerPassword: decodeURIComponent(parsed.password),
    directHost: toDirectHost(parsed.hostname) + (parsed.port ? `:${parsed.port}` : ""),
    pooledHost: toPooledHost(toDirectHost(parsed.hostname)) + (parsed.port ? `:${parsed.port}` : ""),
    databaseName: parsed.pathname.replace(/^\//, "") || "neondb",
  };
}

function buildBootstrapSql(rolePasswords) {
  const template = readFileSync(join(repositoryRoot, "infra/database/bootstrap/bootstrap.sql"), "utf8");
  return template
    .split("\n")
    .filter((line) => !line.startsWith("\\")) // psql-only commands
    .join("\n")
    .replace(":'web_app_password'", sqlLiteral(rolePasswords.web))
    .replace(":'payment_app_password'", sqlLiteral(rolePasswords.payment))
    .replace(":'monitoring_app_password'", sqlLiteral(rolePasswords.monitoring));
}

async function main() {
  if (existsSync(outputFile) && !shouldOverwrite) {
    console.error(`${outputFile} already exists. Use the values in it, or re-run with --force to create NEW secrets.`);
    process.exit(1);
  }

  const answers = await askQuestions();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(answers.adminEmail ?? "")) {
    throw new Error("Please enter a valid admin e-mail address.");
  }
  if ((answers.adminName ?? "").length > 80) {
    throw new Error("The display name must be at most 80 characters.");
  }
  const database = parseOwnerUrl(answers.ownerUrl);

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwtPublicKeyBase64 = Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64");
  const jwtPrivateKeyBase64 = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64");
  const jwtKeyId = `prod-${new Date().toISOString().slice(0, 10)}`;
  const csrfSecret = randomSecret(32);
  const rolePasswords = { web: randomSecret(), payment: randomSecret(), monitoring: randomSecret() };
  const adminPassword = randomSecret(15);
  const guestPassword = randomSecret(32); // nobody types it: guests use the button

  const ownerUrl = `postgresql://${encodeURIComponent(database.ownerUser)}:${encodeURIComponent(database.ownerPassword)}@${database.directHost}/${database.databaseName}?sslmode=require`;
  const webDatabaseUrl = `postgresql://zestops_web_app:${rolePasswords.web}@${database.pooledHost}/${database.databaseName}?sslmode=require`;
  const paymentDatabaseUrl = `postgres://zestops_payment_app:${rolePasswords.payment}@${database.directHost}/${database.databaseName}?sslmode=require`;
  const monitoringDatabaseUrl = `postgresql+asyncpg://zestops_monitoring_app:${rolePasswords.monitoring}@${database.directHost}/${database.databaseName}?ssl=require`;

  const usersSql = `INSERT INTO identity.users (email, display_name, password_hash, role) VALUES
  (${sqlLiteral(answers.adminEmail)}, ${sqlLiteral(answers.adminName)}, ${sqlLiteral(await hashPassword(adminPassword))}, 'admin'),
  (${sqlLiteral(GUEST_EMAIL)}, 'Guest Viewer', ${sqlLiteral(await hashPassword(guestPassword))}, 'viewer')
ON CONFLICT (lower(email)) DO NOTHING;

SELECT email, role FROM identity.users ORDER BY role;`;

  const line = "=".repeat(78);
  const report = `ZestOps PRODUCTION setup — generated ${new Date().toISOString()}
KEEP THIS FILE PRIVATE. Copy the values into a password manager, then DELETE this file.
Never commit it, never paste it into a chat.

${line}
YOUR ADMIN LOGIN (you can change the password later in Settings)
${line}
E-mail:   ${answers.adminEmail}
Password: ${adminPassword}

${line}
STEP A — Neon SQL Editor: paste EVERYTHING between the lines and click "Run"
(creates the 3 schemas and 3 least-privilege database users)
${line}
${buildBootstrapSql(rolePasswords)}
${line}

${line}
STEP B — GitHub: secret for the "Database migrate" workflow
${line}
GitHub repo > Settings > Environments > New environment "production"
  > Add environment secret
Name:  DATABASE_OWNER_URL
Value: ${ownerUrl}

Then: Actions > "Database migrate" > Run workflow > environment: production, command: up

${line}
STEP C — Neon SQL Editor again (AFTER step B is green): paste and click "Run"
(creates your admin account and the read-only guest account)
${line}
${usersSql}
${line}

${line}
LATER — Render (Blueprint) values  [the guide will tell you when]
${line}
zestops-payment-api
  DATABASE_URL                    = ${paymentDatabaseUrl}
  INTERNAL_JWT_PUBLIC_KEY_BASE64  = ${jwtPublicKeyBase64}

zestops-monitoring-api
  DATABASE_URL                    = ${monitoringDatabaseUrl}
  INTERNAL_JWT_PUBLIC_KEY_BASE64  = ${jwtPublicKeyBase64}
  MONITORING_ALLOWED_TARGETS      = ${PAYMENT_API_URL},${MONITORING_API_URL}
  (if Render gives your services different URLs, use those instead)

${line}
LATER — Vercel environment variables  [the guide will tell you when]
${line}
APP_ENV                          = production
APP_ORIGIN                       = https://<your-project>.vercel.app   (fill in after the first deploy)
DATABASE_URL                     = ${webDatabaseUrl}
PAYMENT_API_BASE_URL             = ${PAYMENT_API_URL}
MONITORING_API_BASE_URL          = ${MONITORING_API_URL}
CSRF_SECRET                      = ${csrfSecret}
INTERNAL_JWT_ISSUER              = zestops-web
INTERNAL_JWT_KEY_ID              = ${jwtKeyId}
INTERNAL_JWT_PRIVATE_KEY_BASE64  = ${jwtPrivateKeyBase64}
SESSION_IDLE_TIMEOUT_MINUTES     = 30
SESSION_ABSOLUTE_TIMEOUT_HOURS   = 8
PUBLIC_DEMO_VIEWER_EMAIL         = ${GUEST_EMAIL}
`;

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputFile, report, { encoding: "utf8", mode: 0o600 });
  console.log(`\nDone. Open this file and follow STEP A, B, C:\n  ${outputFile}\n`);
  console.log("It is git-ignored. Delete it after copying the values into a password manager.");
}

main().catch((error) => {
  console.error(`\nSetup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
