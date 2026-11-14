"""Aggregated monitoring statistics for the dashboard."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.incident_repository import IncidentRepository
from app.repositories.service_repository import ServiceRepository
from app.schemas.summary import MonitoringSummaryResponse


async def build_monitoring_summary(session: AsyncSession) -> MonitoringSummaryResponse:
    services = ServiceRepository(session)
    incidents = IncidentRepository(session)

    all_services = await services.list_services()
    latest_checks = await services.latest_check_by_service()
    services_by_status = {"up": 0, "degraded": 0, "down": 0, "unknown": 0}
    for service in all_services:
        if not service.is_enabled:
            continue
        latest_check = latest_checks.get(service.id)
        services_by_status[latest_check.status if latest_check else "unknown"] += 1

    unresolved_by_severity = await incidents.count_unresolved_by_severity()
    total_checks, healthy_checks = await services.count_checks_since(datetime.now(UTC) - timedelta(hours=24))

    return MonitoringSummaryResponse(
        total_services=len(all_services),
        enabled_services=sum(1 for service in all_services if service.is_enabled),
        services_by_status=services_by_status,
        open_incidents=sum(unresolved_by_severity.values()),
        open_incidents_by_severity={
            severity: unresolved_by_severity.get(severity, 0)
            for severity in ("critical", "high", "medium", "low")
        },
        checks_last_24_hours=total_checks,
        overall_uptime_percent_24h=round(healthy_checks * 100 / total_checks, 1) if total_checks else None,
    )
