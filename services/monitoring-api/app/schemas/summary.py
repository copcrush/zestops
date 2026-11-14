from __future__ import annotations

from pydantic import BaseModel


class MonitoringSummaryResponse(BaseModel):
    total_services: int
    enabled_services: int
    services_by_status: dict[str, int]
    open_incidents: int
    open_incidents_by_severity: dict[str, int]
    checks_last_24_hours: int
    overall_uptime_percent_24h: float | None
