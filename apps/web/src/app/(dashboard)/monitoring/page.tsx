import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DemoSeedBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState, ErrorState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { CheckStatusBadge } from "@/components/ui/status-badges";
import { DataTable, TableCell, TableHeaderCell } from "@/components/ui/table";
import { hasPermission } from "@/features/auth/permissions";
import { requireSession } from "@/features/auth/server/current-session";
import { RegisterServiceDialog, RunAllChecksButton, ServiceRowActions } from "@/features/monitoring/components/monitoring-actions";
import { getMonitoringSummary, listAllowedTargets, listMonitoredServices } from "@/features/monitoring/server/monitoring-api";
import { describeBackendFailure } from "@/lib/server/backend-client";
import { formatRelativeTime } from "@/lib/shared/format";

export const metadata: Metadata = { title: "Service monitoring" };

export default async function MonitoringPage() {
  const { user } = await requireSession();
  const canManage = hasPermission(user.role, "manageMonitoredServices");

  const [services, summary, allowedTargets] = await Promise.allSettled([
    listMonitoredServices(user),
    getMonitoringSummary(user),
    canManage ? listAllowedTargets(user) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader eyebrow="Monitoring" title="Service health"
                  description="Controlled, on-demand health checks of approved services. Each check records latency and status history."
                  actions={canManage ? (
                    <>
                      <RunAllChecksButton />
                      <RegisterServiceDialog allowedTargets={allowedTargets.status === "fulfilled" ? allowedTargets.value : []} />
                    </>
                  ) : null} />

      {summary.status === "fulfilled" ? (
        <section aria-label="Monitoring summary" className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Up" value={summary.value.services_by_status.up} accent="lime" />
          <StatCard label="Degraded" value={summary.value.services_by_status.degraded} accent="lemon" />
          <StatCard label="Down" value={summary.value.services_by_status.down} accent="coral" />
          <StatCard label="Uptime (24 h)" accent="sky"
                    value={summary.value.overall_uptime_percent_24h === null ? "—" : `${summary.value.overall_uptime_percent_24h}%`}
                    hint={`${summary.value.checks_last_24_hours} checks`} />
        </section>
      ) : null}

      <Alert tone="info" title="Checks run on demand" className="mb-6">
        ZestOps does not claim 24/7 monitoring: checks run when an admin triggers them. Free hosting tiers sleep when idle,
        so continuous scheduling would need an always-on worker (see docs/KNOWN_LIMITATIONS.md).
      </Alert>

      <Card>
        <CardHeader title="Approved services" description="Targets are restricted by a server-side allowlist (SSRF protection)"
                    actions={<span className="inline-flex items-center gap-1 text-xs font-semibold"><ShieldCheck aria-hidden className="size-4" /> SSRF-guarded</span>} />
        {services.status === "rejected" ? (
          <ErrorState message={describeBackendFailure(services.reason)} />
        ) : services.value.length === 0 ? (
          <EmptyState title="No services yet" description={canManage ? "Register an approved service to start monitoring." : "An administrator has not registered any services yet."} />
        ) : (
          <DataTable caption="Monitored services">
            <thead>
              <tr>
                <TableHeaderCell>Service</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Latency</TableHeaderCell>
                <TableHeaderCell className="text-right">Uptime 24 h</TableHeaderCell>
                <TableHeaderCell>Last check</TableHeaderCell>
                {canManage ? <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell> : null}
              </tr>
            </thead>
            <tbody>
              {services.value.map((service) => (
                <tr key={service.id} className={service.is_enabled ? "hover:bg-lime-soft" : "bg-mist/60 text-muted"}>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Link href={`/monitoring/${service.id}`} className="font-semibold hover:underline">{service.name}</Link>
                      <span className="max-w-xs truncate font-mono text-xs text-muted">{service.target_url}</span>
                      <div className="flex gap-1">
                        {service.is_demo_seed ? <DemoSeedBadge /> : null}
                        {!service.is_enabled ? <span className="text-xs font-semibold">Disabled</span> : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <CheckStatusBadge status={service.latest_check?.status ?? "unknown"} />
                    {service.latest_check?.error_code ? <p className="mt-1 font-mono text-[11px] text-coral-strong">{service.latest_check.error_code}</p> : null}
                  </TableCell>
                  <TableCell className="tabular text-right font-mono">{service.latest_check?.latency_ms != null ? `${service.latest_check.latency_ms} ms` : "—"}</TableCell>
                  <TableCell className="tabular text-right font-mono">{service.uptime_percent_24h != null ? `${service.uptime_percent_24h}%` : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted">{formatRelativeTime(service.latest_check?.checked_at)}</TableCell>
                  {canManage ? <TableCell><ServiceRowActions service={service} /></TableCell> : null}
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
