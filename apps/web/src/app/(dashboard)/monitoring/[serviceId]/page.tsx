import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DemoSeedBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { CheckStatusBadge } from "@/components/ui/status-badges";
import { DataTable, TableCell, TableHeaderCell } from "@/components/ui/table";
import { hasPermission } from "@/features/auth/permissions";
import { requireSession } from "@/features/auth/server/current-session";
import { LatencyChart } from "@/features/monitoring/components/latency-chart";
import { ServiceRowActions } from "@/features/monitoring/components/monitoring-actions";
import { getMonitoredService } from "@/features/monitoring/server/monitoring-api";
import { BackendRequestError, describeBackendFailure } from "@/lib/server/backend-client";
import { formatDateTime } from "@/lib/shared/format";
import { uuidSchema } from "@/lib/shared/validation-schemas";
import type { MonitoredServiceDetail } from "@/types/monitoring";

export const metadata: Metadata = { title: "Service details" };

export default async function ServiceDetailsPage({ params }: PageProps<"/monitoring/[serviceId]">) {
  const { user } = await requireSession();
  const { serviceId } = await params;
  if (!uuidSchema.safeParse(serviceId).success) {
    notFound();
  }

  let service: MonitoredServiceDetail;
  try {
    service = await getMonitoredService(user, serviceId);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 404) {
      notFound();
    }
    return <ErrorState message={describeBackendFailure(error)} />;
  }

  const settings: [string, string][] = [
    ["Target URL", service.target_url],
    ["Expected status", String(service.expected_status_code)],
    ["Timeout", `${service.timeout_ms} ms`],
    ["Slow after", `${service.degraded_threshold_ms} ms`],
    ["Registered", formatDateTime(service.created_at)],
    ["Uptime (24 h)", service.uptime_percent_24h != null ? `${service.uptime_percent_24h}%` : "—"],
  ];

  return (
    <>
      <ButtonLink href="/monitoring" variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>Monitoring</ButtonLink>
      <div className="mt-4">
        <PageHeader eyebrow="Service" title={service.name} description={service.description || undefined}
                    actions={<div className="flex items-center gap-2">
                      {service.is_demo_seed ? <DemoSeedBadge /> : null}
                      <CheckStatusBadge status={service.latest_check?.status ?? "unknown"} />
                      {hasPermission(user.role, "runHealthChecks") ? <ServiceRowActions service={service} /> : null}
                    </div>} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader title="Configuration" />
          <CardBody>
            <dl className="flex flex-col gap-3">
              {settings.map(([label, value]) => (
                <div key={label}>
                  <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</dt>
                  <dd className="mt-0.5 break-all font-mono text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Latency" description="Most recent checks" />
          <CardBody>
            {service.recent_checks.length > 0 ? <LatencyChart checks={service.recent_checks} /> : (
              <EmptyState title="No checks yet" description="Run a check to start collecting history." />
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Check history" description="Last 50 checks, newest first" />
        {service.recent_checks.length === 0 ? (
          <EmptyState title="No history" />
        ) : (
          <DataTable caption={`Check history for ${service.name}`}>
            <thead>
              <tr>
                <TableHeaderCell>Checked</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">HTTP</TableHeaderCell>
                <TableHeaderCell className="text-right">Latency</TableHeaderCell>
                <TableHeaderCell>Details</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {service.recent_checks.map((check) => (
                <tr key={check.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(check.checked_at)}</TableCell>
                  <TableCell><CheckStatusBadge status={check.status} /></TableCell>
                  <TableCell className="tabular text-right font-mono">{check.http_status_code ?? "—"}</TableCell>
                  <TableCell className="tabular text-right font-mono">{check.latency_ms != null ? `${check.latency_ms} ms` : "—"}</TableCell>
                  <TableCell className="text-sm">
                    {check.error_code ? <span className="font-mono text-xs font-bold">{check.error_code}</span> : null}
                    {check.error_message ? <span className="ml-2 text-muted">{check.error_message}</span> : null}
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
