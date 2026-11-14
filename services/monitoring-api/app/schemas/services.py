from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import Field, StrictBool, StrictInt, model_validator

from app.schemas.common import CleanText, RequestModel, ResponseModel


class ServiceCreateRequest(RequestModel):
    name: CleanText = Field(min_length=1, max_length=80)
    description: CleanText = Field(default="", max_length=280)
    target_url: str = Field(min_length=8, max_length=2048)
    expected_status_code: StrictInt = Field(default=200, ge=100, le=599)
    timeout_ms: StrictInt = Field(default=3000, ge=100, le=10000)
    degraded_threshold_ms: StrictInt = Field(default=1000, ge=1, le=10000)

    @model_validator(mode="after")
    def threshold_below_timeout(self) -> Self:
        if self.degraded_threshold_ms > self.timeout_ms:
            raise ValueError("degraded_threshold_ms must not exceed timeout_ms")
        return self


class ServiceUpdateRequest(RequestModel):
    description: CleanText | None = Field(default=None, max_length=280)
    expected_status_code: StrictInt | None = Field(default=None, ge=100, le=599)
    timeout_ms: StrictInt | None = Field(default=None, ge=100, le=10000)
    degraded_threshold_ms: StrictInt | None = Field(default=None, ge=1, le=10000)
    is_enabled: StrictBool | None = None


class CheckResultResponse(ResponseModel):
    id: int
    service_id: uuid.UUID
    status: Literal["up", "degraded", "down"]
    http_status_code: int | None
    latency_ms: int | None
    error_code: str | None
    error_message: str | None
    checked_at: datetime
    triggered_by: uuid.UUID | None


class ServiceResponse(ResponseModel):
    id: uuid.UUID
    name: str
    description: str
    target_url: str
    expected_status_code: int
    timeout_ms: int
    degraded_threshold_ms: int
    is_enabled: bool
    is_demo_seed: bool
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class ServiceWithLatestCheckResponse(ServiceResponse):
    latest_check: CheckResultResponse | None
    uptime_percent_24h: float | None


class ServiceDetailResponse(ServiceWithLatestCheckResponse):
    recent_checks: list[CheckResultResponse]


class RunChecksResponse(ResponseModel):
    results: list[CheckResultResponse]
    incidents_opened: int
