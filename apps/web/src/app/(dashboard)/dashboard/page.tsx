import { Activity, CircleCheck, CreditCard, Siren, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { StatCard } from "@/components/ui/stat-card";
import { CheckStatusBadge, IncidentStatusBadge, PaymentStatusBadge, SeverityBadge } from "@/components/ui/status-badges";
import { DataTable, TableCell, TableHeaderCell } from "@/components/ui/table";
import { requireSession } from "@/features/auth/server/current-session";
import { getMonitoringSummary, listIncidents, listMonitoredServices } from "@/features/monitoring/server/monitoring-api";
import { getPaymentSummary, listCurrencies, listPayments } from "@/features/payments/server/payment-api";
import { describeBackendFailure } from "@/lib/server/backend-client";
import { formatRelativeTime, pluralize } from "@/lib/shared/format";
import { DEFAULT_MINOR_UNIT_EXPONENTS, formatMoney } from "@/lib/shared/money";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardOverviewPage() {
  const { user } = await requireSession();

  // Load everything in parallel. allSettled: if one backend is down, the other
  // sections still render (graceful degradation).
  const [paymentSummary, recentPayments, currencies, monitoringSummary, services, openIncidents] =
    await Promise.allSettled([
      getPaymentSummary(user),
      listPayments(user, { limit: 5 }),
      listCurrencies(user),
      getMonitoringSummary(user),
      listMonitoredServices(user),
      listIncidents(user, { status: "unresolved", limit: 5 }),
    ]);

  const exponents: Record<string, number> = currencies.status === "fulfilled"
    ? Object.fromEntries(currencies.value.map((currency) => [currency.code, currency.minor_unit_exponent]))
    : { ...DEFAULT_MINOR_UNIT_EXPONENTS };

  return (
    <>
      <PageHeader eyebrow="Overview" title={`Hello, ${user.displayName}`}
                  description="Payments and service health at a glance. All payments are simulated."
                  actions={<ButtonLink href="/payments" variant="primary" icon={<CreditCard aria-hidden className="size-4" />}>View payments</ButtonLink>} />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {paymentSummary.status === "fulfilled" ? (
          <>
            <StatCard label="Payments" value={paymentSummary.value.total_count} accent="lime"
                      icon={<CreditCard aria-hidden className="size-4" />}
                      hint={`${paymentSummary.value.created_last_24_hours} created in the last 24 h`} />
            <StatCard label="Success rate" accent="lemon" icon={<CircleCheck aria-hidden className="size-4" />}
                      value={paymentSummary.value.success_rate_percent === null ? "—" : `${paymentSummary.value.success_rate_percent}%`}
                      hint="Succeeded ÷ (succeeded + failed)" />
          </>
        ) : (
          <div className="sm:col-span-2"><ErrorState message={describeBackendFailure(paymentSummary.reason)} /></div>
        )}
        {monitoringSummary.status === "fulfilled" ? (
          <>
            <StatCard label="Uptime (24 h)" accent="sky" icon={<Activity aria-hidden className="size-4" />}
                      value={monitoringSummary.value.overall_uptime_percent_24h === null ? "—" : `${monitoringSummary.value.overall_uptime_percent_24h}%`}
                      hint={`${pluralize(monitoringSummary.value.checks_last_24_hours, "check")} across ${pluralize(monitoringSummary.value.enabled_services, "service")}`} />
            <StatCard label="Open incidents" accent={monitoringSummary.value.open_incidents > 0 ? "coral" : "lime"}
                      icon={<Siren aria-hidden className="size-4" />} value={monitoringSummary.value.open_incidents}
                      hint={`${monitoringSummary.value.open_incidents_by_severity.critical} critical · ${monitoringSummary.value.open_incidents_by_severity.high} high`} />
          </>
        ) : (
          <div className="sm:col-span-2"><ErrorState message={describeBackendFailure(monitoringSummary.reason)} /></div>
        )}
      </section>

      {paymentSummary.status === "fulfilled" && paymentSummary.value.succeeded_totals.length > 0 ? (
        <section aria-labelledby="volume-title" className="mt-6">
          <Card>
            <CardHeader titleId="volume-title" title="Settled volume" description="Sum of succeeded payments per currency" />
            <CardBody className="flex flex-wrap gap-3">
              {paymentSummary.value.succeeded_totals.map((total) => (
                <div key={total.currency} className="flex items-center gap-3 rounded-brutal border-2 border-ink bg-lime-soft px-4 py-3">
                  <Wallet aria-hidden className="size-5" />
                  <div>
                    <p className="tabular font-mono text-lg font-bold">
                      {formatMoney(total.total_amount_minor, total.currency, exponents[total.currency] ?? 2)}
                    </p>
                    <p className="text-xs text-muted">{pluralize(total.payment_count, "payment")} · {total.currency}</p>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </section>
      ) : null}

      <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Recent payments" actions={<Link href="/payments" className="text-sm font-semibold underline underline-offset-4">All payments</Link>} />
          {recentPayments.status === "rejected" ? (
            <ErrorState message={describeBackendFailure(recentPayments.reason)} />
          ) : recentPayments.value.data.length === 0 ? (
            <EmptyState title="No payments yet" description="Create a simulated payment to see it here." />
          ) : (
            <DataTable caption="Five most recent payments">
              <thead>
                <tr>
                  <TableHeaderCell>Reference</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                </tr>
              </thead>
              <tbody>
                {recentPayments.value.data.map((payment) => (
                  <tr key={payment.id} className="hover:bg-lime-soft">
                    <TableCell>
                      <Link href={`/payments/${payment.id}`} className="whitespace-nowrap font-mono text-xs font-bold underline-offset-4 hover:underline">
                        {payment.reference}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular text-right font-mono">
                      {formatMoney(payment.amount_minor, payment.currency, exponents[payment.currency] ?? 2)}
                    </TableCell>
                    <TableCell><PaymentStatusBadge status={payment.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{formatRelativeTime(payment.created_at)}</TableCell>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Service health" actions={<Link href="/monitoring" className="text-sm font-semibold underline underline-offset-4">Monitoring</Link>} />
            {services.status === "rejected" ? (
              <ErrorState message={describeBackendFailure(services.reason)} />
            ) : services.value.length === 0 ? (
              <EmptyState title="No services registered" description="Register an approved service on the Monitoring page." />
            ) : (
              <ul className="divide-y divide-ink/15">
                {services.value.map((service) => (
                  <li key={service.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/monitoring/${service.id}`} className="truncate font-semibold hover:underline">{service.name}</Link>
                      <p className="text-xs text-muted">
                        {service.latest_check ? `checked ${formatRelativeTime(service.latest_check.checked_at)}` : "never checked"}
                        {service.uptime_percent_24h !== null ? ` · ${service.uptime_percent_24h}% uptime` : ""}
                      </p>
                    </div>
                    <CheckStatusBadge status={service.is_enabled ? service.latest_check?.status ?? "unknown" : "unknown"} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Open incidents" actions={<Link href="/incidents" className="text-sm font-semibold underline underline-offset-4">Incidents</Link>} />
            {openIncidents.status === "rejected" ? (
              <ErrorState message={describeBackendFailure(openIncidents.reason)} />
            ) : openIncidents.value.data.length === 0 ? (
              <EmptyState title="All clear" description="No unresolved incidents right now." icon={<CircleCheck aria-hidden className="size-6" />} />
            ) : (
              <ul className="divide-y divide-ink/15">
                {openIncidents.value.data.map((incident) => (
                  <li key={incident.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={incident.severity} />
                      <IncidentStatusBadge status={incident.status} />
                    </div>
                    <Link href={`/incidents/${incident.id}`} className="mt-1.5 block font-semibold hover:underline">{incident.title}</Link>
                    <p className="text-xs text-muted">{incident.reference} · opened {formatRelativeTime(incident.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
