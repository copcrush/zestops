import "server-only";

import { type BackendActor, getFromBackend } from "@/lib/server/backend-client";
import type {
  CheckResult,
  IncidentDetail,
  IncidentPage,
  IncidentSeverity,
  MonitoredServiceDetail,
  MonitoredServiceWithStatus,
  MonitoringSummary,
} from "@/types/monitoring";

/** Typed read helpers for the Python Monitoring API (used by Server Components). */

export async function listMonitoredServices(actor: BackendActor): Promise<MonitoredServiceWithStatus[]> {
  return (await getFromBackend<{ data: MonitoredServiceWithStatus[] }>("monitoring", "/v1/services", actor)).data;
}

export async function getMonitoredService(actor: BackendActor, serviceId: string): Promise<MonitoredServiceDetail> {
  return (await getFromBackend<{ data: MonitoredServiceDetail }>("monitoring",
    `/v1/services/${encodeURIComponent(serviceId)}`, actor)).data;
}

export async function listRecentChecks(actor: BackendActor, limit = 20): Promise<CheckResult[]> {
  return (await getFromBackend<{ data: CheckResult[] }>("monitoring", `/v1/checks?limit=${limit}`, actor)).data;
}

export async function getMonitoringSummary(actor: BackendActor): Promise<MonitoringSummary> {
  return (await getFromBackend<{ data: MonitoringSummary }>("monitoring", "/v1/monitoring/summary", actor)).data;
}

export async function listAllowedTargets(actor: BackendActor): Promise<string[]> {
  return (await getFromBackend<{ data: string[] }>("monitoring", "/v1/allowed-targets", actor)).data;
}

export interface IncidentListQuery {
  status?: "open" | "investigating" | "resolved" | "unresolved";
  severity?: IncidentSeverity;
  cursor?: string;
  limit?: number;
}

export function listIncidents(actor: BackendActor, listQuery: IncidentListQuery = {}): Promise<IncidentPage> {
  const searchParams = new URLSearchParams();
  if (listQuery.status) searchParams.set("status", listQuery.status);
  if (listQuery.severity) searchParams.set("severity", listQuery.severity);
  if (listQuery.cursor) searchParams.set("cursor", listQuery.cursor);
  searchParams.set("limit", String(listQuery.limit ?? 20));
  return getFromBackend<IncidentPage>("monitoring", `/v1/incidents?${searchParams.toString()}`, actor);
}

export async function getIncident(actor: BackendActor, incidentId: string): Promise<IncidentDetail> {
  return (await getFromBackend<{ data: IncidentDetail }>("monitoring",
    `/v1/incidents/${encodeURIComponent(incidentId)}`, actor)).data;
}
