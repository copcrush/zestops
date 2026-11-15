# User Acceptance Testing (UAT) Checklist

Run this as the owner on `http://localhost:3000` first, then on the production URL after
deployment. Tick each item and note anything unexpected.

Accounts — local: `admin@zestops.demo / LocalAdmin#2026`, `viewer@zestops.demo / LocalViewer#2026`,
or the **Explore as guest** button. Production: your admin account + the guest button.

## 1. Access & authentication

- [ ] Opening any page while signed out redirects to Sign in.
- [ ] Wrong password shows a generic error; correct password signs in.
- [ ] "Explore as guest" signs in as the read-only viewer without a password.
- [ ] Sign out returns to the login page; Back button does not show private data.
- [ ] Settings: change display name (admin); change password signs out other browsers.

## 2. Payments (admin)

- [ ] Create a payment of `1,234.56 THB`; detail page shows `THB 1,234.56` and `123456` minor units.
- [ ] JPY rejects decimals; THB rejects 3 decimals.
- [ ] Simulate success → status SUCCEEDED, history shows 3 entries.
- [ ] Create another → Simulate failure with a reason → FAILED with the reason shown.
- [ ] Cancel a pending payment → CANCELLED; it cannot be simulated afterwards.
- [ ] Filter by status and search by reference; "Next page" works when there are > 20 payments.
- [ ] Seeded rows show the **DEMO SEED** badge.

## 3. Monitoring & incidents (admin)

- [ ] Run all checks → toast summary; Payment API and Monitoring API are UP.
- [ ] Demo Unstable Endpoint is DOWN and an incident exists for it (no duplicates after re-running).
- [ ] Register `http://169.254.169.254/latest/meta-data/` → rejected (SSRF protection).
- [ ] Service detail page shows the latency chart and history.
- [ ] Report an incident → Start investigating → Resolve (a note is required) → timeline shows each step.

## 4. Viewer / guest (read-only)

- [ ] No "New payment", "Run all checks", "Register service", "Report incident" buttons.
- [ ] Payment and incident details show read-only notices.
- [ ] `/audit` shows the 403 page.
- [ ] Guest Settings shows the shared-account notice and no password form.

## 5. Quality

- [ ] Mobile (phone width): menu button works, no sideways scrolling, tables scroll inside cards.
- [ ] Keyboard only: Tab reaches every control with a visible focus ring; dialogs close with Esc.
- [ ] DevTools console shows no errors or CSP violations.
- [ ] Stopping the Payment API (`docker compose stop payment-api`) shows a friendly error
      section on the dashboard while monitoring data still loads; start it again afterwards.

## 6. Production only

- [ ] `node scripts/smoke-test.mjs --web ... --payment ... --monitoring ...` → all checks pass.
- [ ] First request after ~15 minutes idle is slow (cold start) but succeeds.
- [ ] Session cookie is `__Host-zestops_session`, HttpOnly, Secure.

Sign-off: ______________________  Date: __________
