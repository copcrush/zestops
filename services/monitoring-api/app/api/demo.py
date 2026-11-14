"""Demo-only endpoint that always fails, used to showcase incident handling.

Registered only when DEMO_ENDPOINTS_ENABLED=true.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(tags=["demo"])


@router.get("/demo/unstable")
async def unstable_endpoint() -> JSONResponse:
    return JSONResponse(status_code=503, content={"status": "unavailable", "demo": True})
