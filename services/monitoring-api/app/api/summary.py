"""HTTP entry point for the monitoring dashboard summary (/v1/monitoring/summary)."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.dependencies import CurrentPrincipal, DatabaseSession
from app.schemas.summary import MonitoringSummaryResponse
from app.services.summary_service import build_monitoring_summary

router = APIRouter(prefix="/v1/monitoring", tags=["summary"])


@router.get("/summary")
async def get_monitoring_summary(
    principal: CurrentPrincipal, session: DatabaseSession
) -> dict[str, MonitoringSummaryResponse]:
    return {"data": await build_monitoring_summary(session)}
