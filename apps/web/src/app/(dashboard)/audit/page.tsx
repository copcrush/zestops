import type { Metadata } from "next";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, TableCell, TableHeaderCell } from "@/components/ui/table";
import { listRecentAuditEvents } from "@/features/auth/server/audit";
import { requirePermission } from "@/features/auth/server/current-session";
import { formatDateTime, humanize } from "@/lib/shared/format";

export const metadata: Metadata = { title: "Audit log" };

const eventTones: Record<string, BadgeTone> = {
  login_succeeded: "lime", logout: "mist", login_failed: "lemon", account_locked: "coral",
  login_rate_limited: "coral", access_denied: "coral", csrf_rejected: "coral", password_changed: "nova",
  password_change_failed: "lemon", profile_updated: "sky", other_sessions_revoked: "nova",
};

/** Admin-only: security events recorded by the web app (no passwords or tokens are ever stored). */
export default async function AuditLogPage() {
  await requirePermission("viewAuditLog");
  const auditEvents = await listRecentAuditEvents(100);

  return (
    <>
      <PageHeader eyebrow="Security" title="Audit log"
                  description="The 100 most recent authentication and authorization events. Payment and incident history are stored by their own services." />
      <Card>
        <CardHeader title="Security events" />
        {auditEvents.length === 0 ? <EmptyState title="No events yet" /> : (
          <DataTable caption="Recent security audit events">
            <thead>
              <tr>
                <TableHeaderCell>Time</TableHeaderCell>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell>User</TableHeaderCell>
                <TableHeaderCell>IP</TableHeaderCell>
                <TableHeaderCell>Details</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {auditEvents.map((auditEvent) => (
                <tr key={auditEvent.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(auditEvent.occurredAt)}</TableCell>
                  <TableCell><Badge tone={eventTones[auditEvent.eventType] ?? "mist"}>{humanize(auditEvent.eventType)}</Badge></TableCell>
                  <TableCell className="text-sm">{auditEvent.actorEmail ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{auditEvent.ipAddress ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs text-muted">
                    {Object.keys(auditEvent.details).length > 0 ? JSON.stringify(auditEvent.details) : "—"}
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
