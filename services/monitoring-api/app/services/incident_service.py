"""Business logic for incidents: creation, investigation and resolution."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError, ValidationFailedError
from app.models import Incident, IncidentEvent
from app.repositories.incident_repository import IncidentRepository
from app.repositories.service_repository import ServiceRepository
from app.schemas.common import PageCursor
from app.schemas.incidents import (
    IncidentCreateRequest,
    IncidentDetailResponse,
    IncidentEventResponse,
    IncidentNoteRequest,
    IncidentResponse,
    IncidentStatusChangeRequest,
)
from app.security.auth import Principal
from app.services.references import generate_reference

logger = logging.getLogger(__name__)

# Incident state machine:  open -> investigating -> resolved,  open -> resolved.
ALLOWED_INCIDENT_TRANSITIONS: dict[str, frozenset[str]] = {
    "open": frozenset({"investigating", "resolved"}),
    "investigating": frozenset({"resolved"}),
    "resolved": frozenset(),
}


def can_transition(current_status: str, next_status: str) -> bool:
    return next_status in ALLOWED_INCIDENT_TRANSITIONS.get(current_status, frozenset())


class IncidentService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.incidents = IncidentRepository(session)
        self.services = ServiceRepository(session)

    async def list_incidents(
        self, status: str | None, severity: str | None, cursor: PageCursor | None, limit: int
    ) -> tuple[list[IncidentResponse], str | None]:
        incidents = await self.incidents.list_incidents(
            status,
            severity,
            cursor.created_at if cursor else None,
            cursor.id if cursor else None,
            limit + 1,
        )
        next_cursor = None
        if len(incidents) > limit:
            incidents = incidents[:limit]
            last_incident = incidents[-1]
            next_cursor = PageCursor(created_at=last_incident.created_at, id=last_incident.id).encode()
        return [IncidentResponse.model_validate(incident) for incident in incidents], next_cursor

    async def get_incident_detail(self, incident_id: uuid.UUID) -> IncidentDetailResponse:
        incident = await self._require_incident(incident_id)
        return await self._build_detail(incident)

    async def create_incident(
        self, principal: Principal, request: IncidentCreateRequest
    ) -> IncidentDetailResponse:
        if request.service_id is not None and await self.services.get_service(request.service_id) is None:
            raise ValidationFailedError("service_id", "does not reference an existing service")

        incident = Incident(
            reference=generate_reference("INC"),
            service_id=request.service_id,
            title=request.title,
            description=request.description,
            severity=request.severity,
            status="open",
            source="manual",
            created_by=principal.user_id,
        )
        self.incidents.add_incident(incident)
        await self.session.flush()
        self.incidents.add_event(
            IncidentEvent(
                incident_id=incident.id,
                event_type="created",
                to_status="open",
                note="Incident opened",
                actor_id=principal.user_id,
            )
        )
        await self.session.commit()
        await self.session.refresh(incident)
        logger.info(
            "incident created",
            extra={
                "incident_id": str(incident.id),
                "severity": incident.severity,
                "user_id": str(principal.user_id),
            },
        )
        return await self._build_detail(incident)

    async def change_status(
        self, principal: Principal, incident_id: uuid.UUID, request: IncidentStatusChangeRequest
    ) -> IncidentDetailResponse:
        # Row lock: two admins resolving at the same moment are handled one at a time.
        incident = await self.incidents.get_incident_for_update(incident_id)
        if incident is None:
            raise NotFoundError("INCIDENT_NOT_FOUND", "Incident not found.")

        previous_status = incident.status
        if not can_transition(previous_status, request.status):
            await self.session.rollback()
            raise ConflictError(
                "INVALID_STATE_TRANSITION",
                f"cannot change incident status from {previous_status} to {request.status}",
                {"current_status": previous_status, "requested_status": request.status},
            )

        now = datetime.now(UTC)
        incident.status = request.status
        if request.status == "investigating" or incident.acknowledged_at is None:
            incident.acknowledged_at = now
            incident.acknowledged_by = principal.user_id
        if request.status == "resolved":
            incident.resolved_at = now
            incident.resolved_by = principal.user_id
            incident.resolution_note = request.note

        self.incidents.add_event(
            IncidentEvent(
                incident_id=incident.id,
                event_type="status_changed",
                from_status=previous_status,
                to_status=request.status,
                note=request.note,
                actor_id=principal.user_id,
            )
        )
        await self.session.commit()
        await self.session.refresh(incident)
        logger.info(
            "incident status changed",
            extra={
                "incident_id": str(incident.id),
                "from_status": previous_status,
                "to_status": request.status,
                "user_id": str(principal.user_id),
            },
        )
        return await self._build_detail(incident)

    async def add_note(
        self, principal: Principal, incident_id: uuid.UUID, request: IncidentNoteRequest
    ) -> IncidentDetailResponse:
        incident = await self._require_incident(incident_id)
        if incident.status == "resolved":
            raise ConflictError("INCIDENT_RESOLVED", "Notes cannot be added to a resolved incident.")
        self.incidents.add_event(
            IncidentEvent(
                incident_id=incident.id,
                event_type="note_added",
                note=request.note,
                actor_id=principal.user_id,
            )
        )
        await self.session.commit()
        return await self._build_detail(incident)

    async def _require_incident(self, incident_id: uuid.UUID) -> Incident:
        incident = await self.incidents.get_incident(incident_id)
        if incident is None:
            raise NotFoundError("INCIDENT_NOT_FOUND", "Incident not found.")
        return incident

    async def _build_detail(self, incident: Incident) -> IncidentDetailResponse:
        events = await self.incidents.list_events(incident.id)
        service = await self.services.get_service(incident.service_id) if incident.service_id else None
        return IncidentDetailResponse(
            **IncidentResponse.model_validate(incident).model_dump(),
            service_name=service.name if service else None,
            events=[IncidentEventResponse.model_validate(event) for event in events],
        )
