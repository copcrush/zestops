# Rollback Runbook

Decide first **what** is broken: the web app, a backend, or the database schema/data.
Roll back the smallest piece that fixes the incident, and record the incident in
ZestOps itself (Incidents page) with the resolution note.

## Web app (Vercel)

1. Vercel → Project → Deployments → pick the last good deployment → **Instant Rollback**
   (or "Promote to Production").
2. Verify with `node scripts/smoke-test.mjs ...` and a manual sign-in.
3. Fix forward on a branch; the next green push to `main` deploys normally.

## Backends (Render)

1. Render → service → **Events / Deploys** → choose the last good deploy → **Rollback**.
2. Wait for `/health/ready` to return `{"status":"ok"}`.
3. Auto-deploy may redeploy the broken commit on the next push; revert the commit on
   `main` (`git revert <sha>`) instead of force-pushing.

## Bad configuration / secret

- Wrong environment variable: fix it in the provider dashboard and redeploy that service.
- Leaked secret: rotate immediately (see key rotation in DEPLOYMENT.md), revoke sessions
  if `CSRF_SECRET` or the JWT key leaked (`DELETE FROM identity.sessions;` as the owner —
  signs everyone out), and check `identity.audit_events` and service logs.

## Database

ZestOps migrations are **forward-only** in production: the migrate workflow exposes only
`up` and `version`. Never run `down`, `drop` or `force` against production from a laptop.

1. **Failed migration (dirty version):** the SQL failed halfway. Inspect what was applied,
   write a corrective migration (`00000N+1_fix_...up.sql`), and run `up`. Only if the
   failed migration provably changed nothing, an owner may run
   `migrate force <previous_version>` manually after a backup.
2. **Code needs the old schema:** roll back the code (above). Because migrations are
   additive/backward compatible, old code keeps working with the newer schema.
3. **Data corruption / accidental deletion:** use Neon's restore features (restore a
   branch to a point in time within the plan's history window, or create a branch from
   a past timestamp and copy the needed rows back). Check the current restore window of
   your plan before relying on it.
4. After any restore: run the smoke test and compare row counts (`payments.payments`,
   `monitoring.incidents`).

## Communication checklist

- [ ] Incident opened in ZestOps (severity, affected service).
- [ ] Rollback performed and verified (smoke test output saved).
- [ ] Root cause written in the incident resolution note.
- [ ] Regression test added before the fix is redeployed.
