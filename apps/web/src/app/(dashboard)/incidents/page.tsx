import { Bot, Filter, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DemoSeedBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { SelectInput } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import { IncidentStatusBadge, SeverityBadge } from "@/components/ui/status-badges";
import { hasPermission } from "@/features/auth/permissions";
import { requireSession } from "@/features/auth/server/current-session";
import { CreateIncidentDialog } from "@/features/incidents/components/incident-forms";
import { type IncidentListQuery, listIncidents, listMonitoredServices } from "@/features/monitoring/server/monitoring-api";
import { describeBackendFailure } from "@/lib/server/backend-client";
import { formatRelativeTime, humanize } from "@/lib/shared/format";
import { INCIDENT_SEVERITIES, type IncidentSeverity } from "@/types/monitoring";

export const metadata: Metadata = { title: "Incidents" };

const statusFilters = ["unresolved", "open", "investigating", "resolved"] as const;

export default async function IncidentsPage({ searchParams }: PageProps<"/incidents">) {
  const { user } = await requireSession();
  const params = await searchParams;
  const statusParam = typeof params.status === "string" ? params.status : "unresolved";
  const status = statusParam === "all" ? undefined
    : statusFilters.find((filter) => filter === statusParam) as IncidentListQuery["status"];
  const severity = INCIDENT_SEVERITIES.find((level) => level === params.severity) as IncidentSeverity | undefined;
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const canManage = hasPermission(user.role, "manageIncidents");

  const [incidentPage, services] = await Promise.allSettled([
    listIncidents(user, { status, severity, cursor, limit: 20 }),
    listMonitoredServices(user),
  ]);
  const serviceNames = new Map(services.status === "fulfilled" ? services.value.map((service) => [service.id, service.name]) : []);
  const filterParams = new URLSearchParams({ status: statusParam, ...(severity ? { severity } : {}) });

  return (
    <>
      <PageHeader eyebrow="Incidents" title="Incident response"
                  description="Failed health checks open incidents automatically. Admins investigate and resolve them with a written resolution."
                  actions={canManage ? <CreateIncidentDialog services={[...serviceNames].map(([id, name]) => ({ id, name }))} /> : null} />

      <Card>
        <form method="get" role="search" aria-label="Filter incidents" className="flex flex-wrap items-end gap-3 border-b-2 border-ink px-5 py-4">
          <div className="flex w-44 flex-col gap-1.5">
            <label htmlFor="status" className="text-sm font-semibold">Status</label>
            <SelectInput id="status" name="status" defaultValue={statusParam}>
              <option value="unresolved">Unresolved</option>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </SelectInput>
          </div>
          <div className="flex w-44 flex-col gap-1.5">
            <label htmlFor="severity" className="text-sm font-semibold">Severity</label>
            <SelectInput id="severity" name="severity" defaultValue={severity ?? ""}>
              <option value="">Any severity</option>
              {INCIDENT_SEVERITIES.map((level) => <option key={level} value={level}>{humanize(level)}</option>)}
            </SelectInput>
          </div>
          <Button type="submit" variant="secondary" icon={<Filter aria-hidden className="size-4" />}>Apply</Button>
        </form>

        {incidentPage.status === "rejected" ? (
          <ErrorState message={describeBackendFailure(incidentPage.reason)} />
        ) : incidentPage.value.data.length === 0 ? (
          <EmptyState title="No incidents match" description={statusParam === "unresolved" ? "Everything is resolved. Nice work." : "Try another filter."} />
        ) : (
          <ul className="divide-y-2 divide-ink/10">
            {incidentPage.value.data.map((incident) => (
              <li key={incident.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 hover:bg-lime-soft">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={incident.severity} />
                    <IncidentStatusBadge status={incident.status} />
                    {incident.is_demo_seed ? <DemoSeedBadge /> : null}
                  </div>
                  <Link href={`/incidents/${incident.id}`} className="mt-2 block text-[17px] font-bold hover:underline">{incident.title}</Link>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className="font-mono font-semibold">{incident.reference}</span>
                    <span className="inline-flex items-center gap-1">
                      {incident.source === "automatic" ? <Bot aria-hidden className="size-3.5" /> : <UserRound aria-hidden className="size-3.5" />}
                      {incident.source === "automatic" ? "Opened by a failed check" : "Reported manually"}
                    </span>
                    {incident.service_id ? <span>Service: {serviceNames.get(incident.service_id) ?? "unknown"}</span> : null}
                    <span>Opened {formatRelativeTime(incident.created_at)}</span>
                  </p>
                </div>
                <ButtonLink href={`/incidents/${incident.id}`} size="sm">Open</ButtonLink>
              </li>
            ))}
          </ul>
        )}
        {incidentPage.status === "fulfilled" && (cursor || incidentPage.value.next_cursor) ? (
          <nav aria-label="Pagination" className="flex justify-end gap-2 border-t-2 border-ink px-5 py-3">
            {cursor ? <ButtonLink size="sm" href={`/incidents?${filterParams.toString()}`}>First page</ButtonLink> : null}
            {incidentPage.value.next_cursor ? (
              <ButtonLink size="sm" variant="primary"
                          href={`/incidents?${new URLSearchParams([...filterParams, ["cursor", incidentPage.value.next_cursor]]).toString()}`}>
                Next page
              </ButtonLink>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
