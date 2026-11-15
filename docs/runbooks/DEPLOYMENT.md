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

## 1. Generate production secrets (never reuse local ones)

On your own computer (not in CI, not in chat):

```bash
node -e "const {generateKeyPairSync,randomBytes}=require('crypto');const {publicKey,privateKey}=generateKeyPairSync('ed25519');const b=(s)=>Buffer.from(s).toString('base64');console.log('INTERNAL_JWT_PUBLIC_KEY_BASE64='+b(publicKey.export({type:'spki',format:'pem'})));console.log('INTERNAL_JWT_PRIVATE_KEY_BASE64='+b(privateKey.export({type:'pkcs8',format:'pem'})));console.log('CSRF_SECRET='+randomBytes(32).toString('base64url'));console.log('INTERNAL_JWT_KEY_ID=prod-'+new Date().toISOString().slice(0,10))"
```

Store them in a password manager. The **private key goes only to Vercel**; the public key
goes to both Render services.

## 2. Database (Neon)

1. Create a project (region close to the backends, e.g. Singapore), database `zestops`.
2. Note the owner connection string (role `neondb_owner` or similar) — used only for
   bootstrap and migrations.
3. Bootstrap schemas and least-privilege roles (choose three strong passwords):

```bash
psql "<OWNER_URL>?sslmode=require" -v web_app_password='...' -v payment_app_password='...' -v monitoring_app_password='...' -f infra/database/bootstrap/bootstrap.sql
```

4. In GitHub → Settings → Environments → create `production` (optionally with required
   reviewers) and add secret `DATABASE_OWNER_URL` = owner URL with `?sslmode=require`.
5. GitHub → Actions → **Database migrate** → Run workflow → `command: version`, then
   `command: up`.
6. Create the first admin user (from your computer):

```bash
cd apps/web && DATABASE_URL="<web role URL>?sslmode=require" NEW_USER_PASSWORD='<long passphrase>' npm run users:create -- --email you@example.com --name "Your Name" --role admin
```

Do **not** run the local seed files against production.

7. Create the **public guest (read-only) account** used by the "Explore as guest" button
   (owner decision: public viewer demo). Use a long random password that nobody needs to
   know — visitors never type it:

```bash
cd apps/web && DATABASE_URL="<web role URL>?sslmode=require" NEW_USER_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")" npm run users:create -- --email guest@zestops.demo --name "Guest Viewer" --role viewer
```

The guest account must have role `viewer`; the app refuses to start a guest session for
any other role, and blocks profile/password/session changes for it.

Connection strings per service (use Neon's **pooled** host for the web app):

| Service | Variable | Format |
|---|---|---|
| Web (Vercel) | `DATABASE_URL` | `postgres://zestops_web_app:<pw>@<pooled-host>/zestops?sslmode=require` |
| Payment API | `DATABASE_URL` | `postgres://zestops_payment_app:<pw>@<host>/zestops?sslmode=require` |
| Monitoring API | `DATABASE_URL` | `postgresql+asyncpg://zestops_monitoring_app:<pw>@<host>/zestops?ssl=require` |

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
