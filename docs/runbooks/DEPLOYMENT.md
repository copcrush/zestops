# Deployment Runbook

> **Status:** prepared, **not yet deployed**. Provider choices and the first public
> deployment require the owner's explicit approval (CLAUDE.md §9).

Target architecture (recommended, pending approval):

| Part | Provider | Plan | Why |
|---|---|---|---|
| Web (Next.js) | **Vercel** | Hobby (free, non-commercial) | Native Next.js 16 support, preview deployments, GitHub integration |
| Payment API + Monitoring API | **Render** web services (Docker) | Free | Runs both Dockerfiles as-is, no credit card, Blueprint in `render.yaml` |
| PostgreSQL | **Neon** | Free | Serverless Postgres, scale-to-zero, roles/schemas supported, branching |

Known free-tier behavior (verify on each provider's pricing page before relying on it):
Render free services **sleep after 15 minutes** without traffic and need roughly
30–60 s to wake up; Neon free compute **scales to zero** after ~5 minutes idle. The UI
shows a friendly "service is starting" message while a backend wakes up. ZestOps does
not claim 24/7 monitoring on this setup.

## 0. Prerequisites (owner)

- GitHub repository `copcrush/zestops` with CI green on `main`.
- Accounts: Vercel, Render, Neon (all sign in with GitHub).

## 1. Neon project

1. Sign in to [Neon](https://neon.com) with GitHub and create a project (ZestOps uses
   project `zestops`, region AWS Asia Pacific (Singapore), default database `neondb`).
2. Neon Console → **Connect** → role `neondb_owner` → copy the connection string.
   Keep it private: it is the owner credential and is only used for setup and migrations.

## 2. Generate all production secrets and the setup SQL (on your computer)

```bash
cd apps/web
```

```bash
npm install
```

```bash
npm run setup:production
```

The script asks three questions (the Neon connection string, your admin e-mail, your
display name) and writes **`.secrets/production-setup.txt`** (git-ignored). It contains:

- your admin login (random password; change it later in Settings),
- **STEP A** — SQL for the Neon SQL Editor: schemas + three least-privilege roles,
- **STEP B** — the GitHub secret `DATABASE_OWNER_URL` for the migration workflow,
- **STEP C** — SQL for the Neon SQL Editor: your admin user + the read-only guest user,
- the exact `DATABASE_URL`, JWT keys and other values for Render and Vercel.

Then:

1. **STEP A** (recommended way — uses exactly the same connection as the GitHub secret,
   so it cannot land in the wrong Neon branch or database):

   ```bash
   npm run setup:production:apply -- A
   ```

   It must print `4 of 4 schemas exist`. (Alternative: Neon SQL Editor, after checking that
   `SELECT current_database();` shows the database from your connection string.)
2. **STEP B:** GitHub → Settings → Environments → **New environment** `production` →
   **Add environment secret** `DATABASE_OWNER_URL`. Then Actions → **Database migrate** →
   **Run workflow** → environment `production`, command `up`. Wait for the green check.
3. **STEP C** (after step B is green):

   ```bash
   npm run setup:production:apply -- C
   ```

   It lists two users: your admin account and `guest@zestops.demo` (viewer).
4. Copy everything into a password manager and **delete** `.secrets/production-setup.txt`.

Notes:

- Connection strings copied from Neon contain `channel_binding=require`; the migration
  script removes it automatically, and the generated service URLs do not use it.
- The SQL only creates objects that do not exist yet, so running it twice is safe.
- Never run the local seed files against production.
- Manual alternative (instead of the script): run `infra/database/bootstrap/bootstrap.sql`
  with `psql -v ...` and create users with `npm run users:create` (see the script header).

## Optional: Neon preview branch per pull request

`.github/workflows/neon-preview-branch.yml` creates a Neon branch for each pull request,
applies the migrations to it and posts a schema diff; the branch is deleted when the PR
closes (and expires after 14 days). It stays inactive until you add, in GitHub →
Settings → Secrets and variables → Actions:

- Variable `NEON_PROJECT_ID` = your Neon project ID (for example `hidden-tree-58545671`)
- Secret `NEON_API_KEY` = a Neon API key (project-scoped is enough)

Preview branches are copies of the production branch, including its data. That is fine
for ZestOps (simulated data only) but would need care in a real product.

## 3. Backends (Render Blueprint)

1. Render → New → **Blueprint** → select `copcrush/zestops` (uses `render.yaml`).
2. Fill the `sync: false` values: `DATABASE_URL`, `INTERNAL_JWT_PUBLIC_KEY_BASE64`, and
   for the Monitoring API `MONITORING_ALLOWED_TARGETS` =
   `https://zestops-payment-api.onrender.com,https://zestops-monitoring-api.onrender.com`
   (use the real service URLs Render shows).
3. Wait for both services to report healthy (`/health/ready`).
4. Register the approved services in the UI later (Monitoring → Register service) using
   `https://<payment-api>/health/ready`, `https://<monitoring-api>/health/ready` and,
   for the incident demo, `https://<monitoring-api>/demo/unstable`.

## 4. Web (Vercel)

1. Vercel → Add New → Project → import `copcrush/zestops`.
2. **Root Directory:** `apps/web` (framework auto-detected: Next.js).
3. Environment variables (Production):

| Variable | Value |
|---|---|
| `APP_ENV` | `production` |
| `APP_ORIGIN` | `https://<your-project>.vercel.app` (exact origin, no trailing slash) |
| `DATABASE_URL` | web role, pooled host, `sslmode=require` |
| `PAYMENT_API_BASE_URL` | `https://zestops-payment-api.onrender.com` |
| `MONITORING_API_BASE_URL` | `https://zestops-monitoring-api.onrender.com` |
| `CSRF_SECRET` | from step 1 |
| `INTERNAL_JWT_ISSUER` | `zestops-web` |
| `INTERNAL_JWT_KEY_ID` | from step 1 |
| `INTERNAL_JWT_PRIVATE_KEY_BASE64` | from step 1 (Vercel **only**) |
| `SESSION_IDLE_TIMEOUT_MINUTES` / `SESSION_ABSOLUTE_TIMEOUT_HOURS` | `30` / `8` |
| `PUBLIC_DEMO_VIEWER_EMAIL` | `guest@zestops.demo` (enables the "Explore as guest" button; omit to disable) |

4. Deploy. Vercel then deploys every push to `main` (production) and every PR (preview).
   Preview deployments have a different origin; give them their own `APP_ORIGIN` or keep
   previews behind Vercel Deployment Protection.

## 5. Verify (production smoke test)

```bash
node scripts/smoke-test.mjs --web https://<project>.vercel.app --payment https://zestops-payment-api.onrender.com --monitoring https://zestops-monitoring-api.onrender.com
```

Then manually: sign in, create a payment, simulate success, run checks, resolve an
incident, sign out. Record the results in the UAT checklist.

## Deployment triggers (no duplicates)

| Component | Trigger |
|---|---|
| Web | Vercel Git integration on push to `main` |
| Backends | Render auto-deploy **after CI checks pass** on `main` (`autoDeployTrigger: checksPass`) |
| Database | Manual `Database migrate` workflow only |

Migrations must be **backward compatible** with the running code (add columns/tables
first, deploy code, remove old things in a later migration), because code and schema
deploy at different times.

## Key rotation (internal JWT)

1. Generate a new key pair and `INTERNAL_JWT_KEY_ID`.
2. Update the public key on both Render services, then the private key + key ID on Vercel.
3. Redeploy backends first, then the web app. Tokens live 60 s, so the overlap is minimal.
