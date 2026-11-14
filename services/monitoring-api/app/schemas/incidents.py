from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import Field, model_validator

from app.schemas.common import CleanText, RequestModel, ResponseModel

IncidentSeverity = Literal["low", "medium", "high", "critical"]
IncidentStatus = Literal["open", "investigating", "resolved"]


class IncidentCreateRequest(RequestModel):
    title: CleanText = Field(min_length=3, max_length=120)
    description: CleanText = Field(default="", max_length=2000)
    severity: IncidentSeverity
    service_id: uuid.UUID | None = None


class IncidentStatusChangeRequest(RequestModel):
    status: Literal["investigating", "resolved"]
    note: CleanText | None = Field(default=None, min_length=3, max_length=2000)

    @model_validator(mode="after")
    def resolution_requires_note(self) -> Self:
        if self.status == "resolved" and not self.note:
            raise ValueError("a note (3-2000 characters) is required to resolve an incident")
        return self


class IncidentNoteRequest(RequestModel):
    note: CleanText = Field(min_length=3, max_length=2000)


class IncidentResponse(ResponseModel):
    id: uuid.UUID
    reference: str
    service_id: uuid.UUID | None
    title: str
    description: str
    severity: IncidentSeverity
    status: IncidentStatus
    source: Literal["manual", "automatic"]
    created_by: uuid.UUID | None
    acknowledged_by: uuid.UUID | None
    acknowledged_at: datetime | None
    resolved_by: uuid.UUID | None
    resolved_at: datetime | None
    resolution_note: str | None
    is_demo_seed: bool
    created_at: datetime
    updated_at: datetime


class IncidentEventResponse(ResponseModel):
    id: int
    event_type: Literal["created", "status_changed", "note_added"]
    from_status: IncidentStatus | None
    to_status: IncidentStatus | None
    note: str | None
    actor_id: uuid.UUID | None
    occurred_at: datetime


class IncidentDetailResponse(IncidentResponse):
    service_name: str | None
    events: list[IncidentEventResponse]
