import { Monitor } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/features/auth/server/current-session";
import { listActiveSessions } from "@/features/auth/server/session";
import { ChangePasswordForm, DisplayNameForm, RevokeOtherSessionsButton } from "@/features/profile/components/profile-forms";
import { formatDateTime, formatRelativeTime } from "@/lib/shared/format";

export const metadata: Metadata = { title: "Settings" };

function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome"
    : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const platform = /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS"
    : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return platform ? `${browser} on ${platform}` : browser;
}

export default async function SettingsPage() {
  const session = await requireSession();
  const { user } = session;
  const activeSessions = await listActiveSessions(user.id, session.sessionId);

  return (
    <>
      <PageHeader eyebrow="Settings" title="Profile & security" description="Manage your profile, password and signed-in devices." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody className="flex flex-col gap-5">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">E-mail</dt><dd className="mt-0.5">{user.email}</dd></div>
              <div><dt className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Role</dt><dd className="mt-1"><Badge tone={user.role === "admin" ? "lemon" : "sky"}>{user.role}</Badge></dd></div>
              <div><dt className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Last sign-in</dt><dd className="mt-0.5">{formatDateTime(user.lastLoginAt)}</dd></div>
              <div><dt className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Session expires</dt><dd className="mt-0.5">{formatDateTime(session.absoluteExpiresAt)}</dd></div>
            </dl>
            <DisplayNameForm />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Password" description="Changing it signs out all your other sessions." />
          <CardBody><ChangePasswordForm /></CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Active sessions" description="Sessions expire after inactivity and after a maximum lifetime."
                    actions={<RevokeOtherSessionsButton otherSessionCount={activeSessions.filter((activeSession) => !activeSession.isCurrent).length} />} />
        <ul className="divide-y divide-ink/15">
          {activeSessions.map((activeSession) => (
            <li key={activeSession.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border-2 border-ink bg-sky"><Monitor aria-hidden className="size-4" /></span>
                <div>
                  <p className="font-semibold">{describeBrowser(activeSession.userAgent)}</p>
                  <p className="text-xs text-muted">Signed in {formatDateTime(activeSession.createdAt)} · active {formatRelativeTime(activeSession.lastSeenAt)}</p>
                </div>
              </div>
              {activeSession.isCurrent ? <Badge tone="lime">This device</Badge> : null}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
