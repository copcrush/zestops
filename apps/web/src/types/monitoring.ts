/** Types mirroring the Python Monitoring API JSON (OpenAPI at /openapi.json in development). */
export type CheckStatus = "up" | "degraded" | "down";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "resolved";

export const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = ["critical", "high", "medium", "low"];

export interface CheckResult {
  id: number;
  service_id: string;
  status: CheckStatus;
  http_status_code: number | null;
  latency_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  checked_at: string;
  triggered_by: string | null;
}

export interface MonitoredService {
  id: string;
  name: string;
  description: string;
  target_url: string;
  expected_status_code: number;
  timeout_ms: number;
  degraded_threshold_ms: number;
  is_enabled: boolean;
  is_demo_seed: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonitoredServiceWithStatus extends MonitoredService {
  latest_check: CheckResult | null;
  uptime_percent_24h: number | null;
}

export interface MonitoredServiceDetail extends MonitoredServiceWithStatus {
  recent_checks: CheckResult[];
}

export interface RunChecksResult {
  results: CheckResult[];
  incidents_opened: number;
}

export interface MonitoringSummary {
  total_services: number;
  enabled_services: number;
  services_by_status: Record<CheckStatus | "unknown", number>;
  open_incidents: number;
  open_incidents_by_severity: Record<IncidentSeverity, number>;
  checks_last_24_hours: number;
  overall_uptime_percent_24h: number | null;
}

export interface Incident {
  id: string;
  reference: string;
  service_id: string | null;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: "manual" | "automatic";
  created_by: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  is_demo_seed: boolean;
  created_at: string;
  updated_at: string;
}

export interface IncidentEvent {
  id: number;
  event_type: "created" | "status_changed" | "note_added";
  from_status: IncidentStatus | null;
  to_status: IncidentStatus | null;
  note: string | null;
  actor_id: string | null;
  occurred_at: string;
}

export interface IncidentDetail extends Incident {
  service_name: string | null;
  events: IncidentEvent[];
}

export interface IncidentPage {
  data: Incident[];
  next_cursor: string | null;
}
