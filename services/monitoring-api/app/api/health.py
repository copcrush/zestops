"""Public health endpoints. They reveal no versions, hosts or error details."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.dependencies import DatabaseSession

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def live() -> dict[str, str]:
    """Is the process running?"""
    return {"status": "ok"}


@router.get("/health/ready", response_model=None)
async def ready(session: DatabaseSession) -> dict[str, object] | JSONResponse:
    """Can the service handle traffic (database reachable)?"""
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503, content={"status": "unavailable", "checks": {"database": "unavailable"}}
        )
    return {"status": "ok", "checks": {"database": "ok"}}
