"""HTTP entry points for incidents (/v1/incidents)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query

from app.api.dependencies import AdminPrincipal, CurrentPrincipal, DatabaseSession
from app.core.errors import ValidationFailedError
from app.schemas.common import PageCursor
from app.schemas.incidents import (
    IncidentCreateRequest,
    IncidentDetailResponse,
    IncidentNoteRequest,
    IncidentResponse,
    IncidentSeverity,
    IncidentStatusChangeRequest,
)
from app.services.incident_service import IncidentService

router = APIRouter(prefix="/v1/incidents", tags=["incidents"])


@router.get("")
async def list_incidents(
    principal: CurrentPrincipal,
    session: DatabaseSession,
    status: Literal["open", "investigating", "resolved", "unresolved"] | None = None,
    severity: IncidentSeverity | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> dict[str, list[IncidentResponse] | str | None]:
    page_cursor = None
    if cursor:
        try:
            page_cursor = PageCursor.decode(cursor)
        except ValueError as error:
            raise ValidationFailedError("cursor", "is invalid") from error
    incidents, next_cursor = await IncidentService(session).list_incidents(
        status, severity, page_cursor, limit
    )
    return {"data": incidents, "next_cursor": next_cursor}


@router.post("", status_code=201)
async def create_incident(
    request: IncidentCreateRequest, principal: AdminPrincipal, session: DatabaseSession
) -> dict[str, IncidentDetailResponse]:
    return {"data": await IncidentService(session).create_incident(principal, request)}


@router.get("/{incident_id}")
async def get_incident(
    incident_id: uuid.UUID, principal: CurrentPrincipal, session: DatabaseSession
) -> dict[str, IncidentDetailResponse]:
    return {"data": await IncidentService(session).get_incident_detail(incident_id)}


@router.post("/{incident_id}/status")
async def change_incident_status(
    incident_id: uuid.UUID,
    request: IncidentStatusChangeRequest,
    principal: AdminPrincipal,
    session: DatabaseSession,
) -> dict[str, IncidentDetailResponse]:
    return {"data": await IncidentService(session).change_status(principal, incident_id, request)}


@router.post("/{incident_id}/notes", status_code=201)
async def add_incident_note(
    incident_id: uuid.UUID, request: IncidentNoteRequest, principal: AdminPrincipal, session: DatabaseSession
) -> dict[str, IncidentDetailResponse]:
    return {"data": await IncidentService(session).add_note(principal, incident_id, request)}
