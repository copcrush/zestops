# Local Setup (Windows & macOS)

You need four tools. Everything else (PostgreSQL, migrations, backends) runs in Docker.

| Tool | Version | Windows | macOS |
|---|---|---|---|
| Git | any recent | [git-scm.com](https://git-scm.com/download/win) | `xcode-select --install` or Homebrew |
| Docker Desktop | 4.x | [docker.com](https://www.docker.com/products/docker-desktop/) (WSL 2 backend) | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Node.js | 22 LTS (≥ 22.12) | [nodejs.org](https://nodejs.org) installer | `brew install node@22` |
| Go *(only to run/debug the Go API outside Docker)* | 1.26+ (1.27.4 is fetched automatically) | [go.dev/dl](https://go.dev/dl/) | `brew install go` |
| uv *(only to run/debug the Python API outside Docker)* | 0.11+ | `powershell -c "irm https://astral.sh/uv/install.ps1 \| iex"` | `brew install uv` |

> Windows: run the commands in **PowerShell** or **Git Bash**. All scripts are Node.js
> or run inside containers, so no Bash is required. Clone the repository inside your
> user folder (not inside OneDrive-synced folders).

## 1. Clone and create local secrets

```bash
git clone https://github.com/copcrush/zestops.git
```

```bash
cd zestops
```

```bash
node scripts/setup-local-env.mjs
```

This generates random local-only secrets (database passwords, the Ed25519 key pair for
internal JWTs, the CSRF secret) into git-ignored files: `.env`, `apps/web/.env.local`,
`services/payment-api/.env`, `services/monitoring-api/.env`.

## 2. Start PostgreSQL, migrations, demo data and the backends

```bash
docker compose up -d --build
```

The first run builds the Go and Python images (a few minutes). Check status:

```bash
docker compose ps
```

`postgres`, `payment-api` and `monitoring-api` should be `healthy`; `migrate` and `seed`
run once and exit with code 0.

## 3. Start the web app

```bash
cd apps/web
```

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:3000** and sign in with a local demo account:

| Role | E-mail | Password |
|---|---|---|
| admin | `admin@zestops.demo` | `LocalAdmin#2026` |
| viewer | `viewer@zestops.demo` | `LocalViewer#2026` |

These accounts exist only in the local database (seed file
`infra/database/seeds/local/01_identity_demo_users.sql`). Rows created by seeds are marked
**DEMO SEED** in the UI.

## Ports

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| Payment API | http://localhost:8080 (`/health/ready`) |
| Monitoring API | http://localhost:8000 (`/health/ready`, API docs at `/docs` in development) |
| PostgreSQL | localhost:5432 (bound to 127.0.0.1 only) |

Ports can be changed in the root `.env` (`POSTGRES_PORT`, `PAYMENT_API_PORT`,
`MONITORING_API_PORT`). If you change them, update the URLs in `apps/web/.env.local` too.

## Running a backend outside Docker (for debugging)

Stop the container first so the port is free:

```bash
docker compose stop payment-api
```

```bash
cd services/payment-api && go run ./cmd/payment-api
```

```bash
docker compose stop monitoring-api
```

```bash
cd services/monitoring-api && uv sync && uv run uvicorn app.main:create_app --factory --reload --port 8000
```

Both read their own `.env` (generated in step 1). The Monitoring API run this way checks
`http://localhost:8080`/`:8000`, which are already in its allowlist.

## Everyday commands

| Task | Command |
|---|---|
| Stop everything (keep data) | `docker compose down` |
| Reset local database (deletes local data!) | `docker compose down -v` then `docker compose up -d --build` |
| Re-run migrations | `docker compose run --rm migrate` |
| Re-load demo data (idempotent) | `docker compose run --rm seed` |
| Show backend logs | `docker compose logs -f payment-api monitoring-api` |
| Create another user | see `apps/web/scripts/create-user.mjs` |

## Switching between Windows and macOS

The repository is the single source of truth; secrets and data stay on each machine.

1. Before leaving a machine: commit and push your branch.

```bash
git status
```

```bash
git push
```

2. On the other machine: pull, then reinstall dependencies only if lockfiles changed.

```bash
git pull
```

```bash
cd apps/web && npm install
```

3. Each machine keeps its own `.env` files and its own Docker database. Run
   `node scripts/setup-local-env.mjs` once per machine (it refuses to overwrite existing files).
4. Line endings are normalized by `.gitattributes`, so Windows and macOS produce identical
   commits. Do not change `core.autocrlf` per machine.

## Troubleshooting

See [runbooks/DEBUGGING.md](runbooks/DEBUGGING.md). The most common issues:

- **Port already in use** — something else listens on 3000/8080/8000/5432. Change the
  port in `.env` or stop the other program (check what it is first).
- **`Run node scripts/setup-local-env.mjs first`** — the root `.env` is missing.
- **Login says invalid credentials right after setup** — the `seed` container did not run;
  run `docker compose run --rm seed`.
- **Endless page reloads in `npm run dev`** — stop the dev server, delete `apps/web/.next`,
  start again (happens after running `npm run build` while the dev server is running).
