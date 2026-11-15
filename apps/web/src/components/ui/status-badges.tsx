import { CircleCheck, CircleDashed, CircleX, Clock3, Loader, Siren, TriangleAlert } from "lucide-react";

import type { CheckStatus, IncidentSeverity, IncidentStatus } from "@/types/monitoring";
import type { PaymentStatus } from "@/types/payments";

import { Badge, type BadgeTone } from "./badge";

const iconClass = "size-3";

const paymentStatusStyles: Record<PaymentStatus, { tone: BadgeTone; icon: React.ReactNode }> = {
  pending: { tone: "lemon", icon: <Clock3 aria-hidden className={iconClass} /> },
  processing: { tone: "sky", icon: <Loader aria-hidden className={iconClass} /> },
  succeeded: { tone: "lime", icon: <CircleCheck aria-hidden className={iconClass} /> },
  failed: { tone: "coral", icon: <CircleX aria-hidden className={iconClass} /> },
  cancelled: { tone: "mist", icon: <CircleDashed aria-hidden className={iconClass} /> },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const style = paymentStatusStyles[status];
  return <Badge tone={style.tone} icon={style.icon}>{status}</Badge>;
}

const checkStatusTones: Record<CheckStatus | "unknown", BadgeTone> = {
  up: "lime", degraded: "lemon", down: "coral", unknown: "mist",
};

export function CheckStatusBadge({ status }: { status: CheckStatus | "unknown" }) {
  return (
    <Badge tone={checkStatusTones[status]}>
      <span aria-hidden className="size-2 rounded-full border border-ink bg-white" />
      {status}
    </Badge>
  );
}

const severityTones: Record<IncidentSeverity, BadgeTone> = {
  critical: "ink", high: "coral", medium: "lemon", low: "sky",
};

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return <Badge tone={severityTones[severity]} icon={severity === "critical" ? <Siren aria-hidden className={iconClass} /> : undefined}>{severity}</Badge>;
}

const incidentStatusTones: Record<IncidentStatus, BadgeTone> = {
  open: "coral", investigating: "lemon", resolved: "lime",
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <Badge tone={incidentStatusTones[status]}
           icon={status === "resolved" ? <CircleCheck aria-hidden className={iconClass} /> : <TriangleAlert aria-hidden className={iconClass} />}>
      {status}
    </Badge>
  );
}
