"""Database queries for incidents and their timelines."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, IncidentEvent


class IncidentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_incidents(
        self,
        status: str | None,
        severity: str | None,
        cursor_created_at: datetime | None,
        cursor_id: uuid.UUID | None,
        limit: int,
    ) -> list[Incident]:
        statement = select(Incident).order_by(Incident.created_at.desc(), Incident.id.desc()).limit(limit)
        if status == "unresolved":
            statement = statement.where(Incident.status != "resolved")
        elif status is not None:
            statement = statement.where(Incident.status == status)
        if severity is not None:
            statement = statement.where(Incident.severity == severity)
        if cursor_created_at is not None and cursor_id is not None:
            statement = statement.where(
                tuple_(Incident.created_at, Incident.id) < (cursor_created_at, cursor_id)
            )
        return list(await self.session.scalars(statement))

    async def get_incident(self, incident_id: uuid.UUID) -> Incident | None:
        return await self.session.get(Incident, incident_id)

    async def get_incident_for_update(self, incident_id: uuid.UUID) -> Incident | None:
        """Load and lock the incident row until the transaction ends."""
        result = await self.session.scalars(
            select(Incident)
            .where(Incident.id == incident_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.one_or_none()

    def add_incident(self, incident: Incident) -> None:
        self.session.add(incident)

    def add_event(self, event: IncidentEvent) -> None:
        self.session.add(event)

    async def list_events(self, incident_id: uuid.UUID) -> list[IncidentEvent]:
        result = await self.session.scalars(
            select(IncidentEvent)
            .where(IncidentEvent.incident_id == incident_id)
            .order_by(IncidentEvent.occurred_at, IncidentEvent.id)
        )
        return list(result)

    async def open_automatic_incident_if_absent(
        self, service_id: uuid.UUID, reference: str, title: str, description: str, severity: str
    ) -> uuid.UUID | None:
        """Open an automatic incident unless one is already unresolved for the service.

        The partial unique index incidents_one_open_automatic_per_service_key makes
        this safe even when two checks fail at exactly the same time.
        Returns the new incident ID, or None if one already existed.
        """
        statement = (
            insert(Incident)
            .values(
                service_id=service_id,
                reference=reference,
                title=title,
                description=description,
                severity=severity,
                status="open",
                source="automatic",
            )
            .on_conflict_do_nothing(
                index_elements=[Incident.service_id],
                index_where=and_(Incident.source == "automatic", Incident.status != "resolved"),
            )
            .returning(Incident.id)
        )
        return (await self.session.execute(statement)).scalar_one_or_none()

    async def has_unresolved_incident_for_service(self, service_id: uuid.UUID) -> bool:
        count = await self.session.scalar(
            select(func.count()).where(Incident.service_id == service_id, Incident.status != "resolved")
        )
        return bool(count)

    async def count_unresolved_by_severity(self) -> dict[str, int]:
        result = await self.session.execute(
            select(Incident.severity, func.count())
            .where(Incident.status != "resolved")
            .group_by(Incident.severity)
        )
        return {severity: int(count) for severity, count in result}
