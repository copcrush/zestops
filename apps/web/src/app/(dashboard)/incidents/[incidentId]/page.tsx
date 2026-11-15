import { ArrowLeft, MessageSquare, PlusCircle, RefreshCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DemoSeedBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, ErrorState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { IncidentStatusBadge, SeverityBadge } from "@/components/ui/status-badges";
import { hasPermission } from "@/features/auth/permissions";
import { requireSession } from "@/features/auth/server/current-session";
import { IncidentWorkflow } from "@/features/incidents/components/incident-forms";
import { getIncident } from "@/features/monitoring/server/monitoring-api";
import { BackendRequestError, describeBackendFailure } from "@/lib/server/backend-client";
import { formatDateTime, shortId } from "@/lib/shared/format";
import { uuidSchema } from "@/lib/shared/validation-schemas";
import type { IncidentDetail, IncidentEvent } from "@/types/monitoring";

export const metadata: Metadata = { title: "Incident details" };

const eventIcons: Record<IncidentEvent["event_type"], React.ReactNode> = {
  created: <PlusCircle aria-hidden className="size-3.5" />,
  status_changed: <RefreshCcw aria-hidden className="size-3.5" />,
  note_added: <MessageSquare aria-hidden className="size-3.5" />,
};

export default async function IncidentDetailsPage({ params }: PageProps<"/incidents/[incidentId]">) {
  const { user } = await requireSession();
  const { incidentId } = await params;
  if (!uuidSchema.safeParse(incidentId).success) {
    notFound();
  }

  let incident: IncidentDetail;
  try {
    incident = await getIncident(user, incidentId);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 404) {
      notFound();
    }
    return <ErrorState message={describeBackendFailure(error)} />;
  }

  const describeActor = (actorId: string | null) =>
    actorId === null ? "system" : actorId === user.id ? "you" : `user ${shortId(actorId)}`;
  const canManage = hasPermission(user.role, "manageIncidents");

  return (
    <>
      <ButtonLink href="/incidents" variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>Incidents</ButtonLink>
      <div className="mt-4">
        <PageHeader eyebrow={incident.reference} title={incident.title}
                    description={incident.service_name ? <>Affected service: <Link className="font-semibold underline" href={`/monitoring/${incident.service_id}`}>{incident.service_name}</Link></> : "Not linked to a specific service"}
                    actions={<div className="flex flex-wrap gap-2">
                      {incident.is_demo_seed ? <DemoSeedBadge /> : null}
                      <SeverityBadge severity={incident.severity} />
                      <IncidentStatusBadge status={incident.status} />
                    </div>} />
      </div>

      {incident.status === "resolved" ? (
        <Alert tone="success" title={`Resolved ${formatDateTime(incident.resolved_at)} by ${describeActor(incident.resolved_by)}`} className="mb-6">
          {incident.resolution_note}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Description" description={`${incident.source === "automatic" ? "Opened automatically" : "Reported"} ${formatDateTime(incident.created_at)}`} />
            <CardBody><p className="whitespace-pre-wrap text-[15px]">{incident.description || "No description provided."}</p></CardBody>
          </Card>
          {incident.status !== "resolved" ? (
            canManage ? (
              <Card className="bg-lemon-soft">
                <CardHeader title="Investigate & resolve" description="open → investigating → resolved" />
                <CardBody><IncidentWorkflow incidentId={incident.id} status={incident.status} /></CardBody>
              </Card>
            ) : (
              <Alert tone="info" title="Read-only access">Only administrators can update incidents.</Alert>
            )
          ) : null}
        </div>

        <Card>
          <CardHeader title="Timeline" />
          <CardBody>
            <ol className="relative flex flex-col gap-4 border-l-2 border-ink pl-5">
              {incident.events.map((event) => (
                <li key={event.id} className="relative">
                  <span aria-hidden className="absolute -left-[31px] top-0 grid size-5 place-items-center rounded-full border-2 border-ink bg-white">
                    {eventIcons[event.event_type]}
                  </span>
                  <p className="text-sm font-semibold">
                    {event.event_type === "status_changed" && event.from_status && event.to_status
                      ? <span className="inline-flex flex-wrap items-center gap-1.5"><IncidentStatusBadge status={event.from_status} /> → <IncidentStatusBadge status={event.to_status} /></span>
                      : event.event_type === "created" ? "Incident opened" : "Note"}
                  </p>
                  {event.note ? <p className="mt-1 whitespace-pre-wrap text-sm">{event.note}</p> : null}
                  <p className="mt-0.5 text-xs text-muted">{formatDateTime(event.occurred_at)} · {describeActor(event.actor_id)}</p>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
