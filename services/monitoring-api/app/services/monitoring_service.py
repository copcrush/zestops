"""Business logic for approved services and health checks."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError, ValidationFailedError
from app.models import CheckResult, IncidentEvent, MonitoredService
from app.repositories.incident_repository import IncidentRepository
from app.repositories.service_repository import ServiceRepository
from app.schemas.services import (
    CheckResultResponse,
    RunChecksResponse,
    ServiceCreateRequest,
    ServiceDetailResponse,
    ServiceResponse,
    ServiceUpdateRequest,
    ServiceWithLatestCheckResponse,
)
from app.security.auth import Principal
from app.security.ssrf import TargetNotAllowedError, TargetPolicy
from app.services.health_checker import CheckOutcome, HealthChecker
from app.services.references import generate_reference

logger = logging.getLogger(__name__)

RECENT_CHECKS_LIMIT = 50


class MonitoringService:
    def __init__(
        self, session: AsyncSession, target_policy: TargetPolicy, health_checker: HealthChecker
    ) -> None:
        self.session = session
        self.services = ServiceRepository(session)
        self.incidents = IncidentRepository(session)
        self.target_policy = target_policy
        self.health_checker = health_checker

    async def list_services(self) -> list[ServiceWithLatestCheckResponse]:
        services = await self.services.list_services()
        latest_checks = await self.services.latest_check_by_service()
        uptime = await self.services.uptime_percent_since(datetime.now(UTC) - timedelta(hours=24))
        return [
            ServiceWithLatestCheckResponse(
                **ServiceResponse.model_validate(service).model_dump(),
                latest_check=_to_check_response(latest_checks.get(service.id)),
                uptime_percent_24h=uptime.get(service.id),
            )
            for service in services
        ]

    async def get_service_detail(self, service_id: uuid.UUID) -> ServiceDetailResponse:
        service = await self._require_service(service_id)
        recent_checks = await self.services.list_check_results(service_id, RECENT_CHECKS_LIMIT)
        uptime = await self.services.uptime_percent_since(datetime.now(UTC) - timedelta(hours=24))
        return ServiceDetailResponse(
            **ServiceResponse.model_validate(service).model_dump(),
            latest_check=_to_check_response(recent_checks[0] if recent_checks else None),
            uptime_percent_24h=uptime.get(service_id),
            recent_checks=[CheckResultResponse.model_validate(check) for check in recent_checks],
        )

    async def register_service(self, principal: Principal, request: ServiceCreateRequest) -> ServiceResponse:
        try:
            validated_target = self.target_policy.validate_url(request.target_url)
        except TargetNotAllowedError as error:
            logger.warning(
                "service registration rejected by SSRF policy",
                extra={"user_id": str(principal.user_id), "reason": str(error)},
            )
            raise ValidationFailedError("target_url", str(error)) from error

        service = MonitoredService(
            name=request.name,
            description=request.description,
            target_url=validated_target.url,
            expected_status_code=request.expected_status_code,
            timeout_ms=request.timeout_ms,
            degraded_threshold_ms=request.degraded_threshold_ms,
            created_by=principal.user_id,
        )
        self.services.add_service(service)
        try:
            await self.session.commit()
        except IntegrityError as error:
            await self.session.rollback()
            if "services_name_key" in str(error.orig):
                raise ConflictError(
                    "SERVICE_NAME_TAKEN", "A service with this name already exists."
                ) from error
            raise
        await self.session.refresh(service)
        logger.info(
            "monitored service registered",
            extra={"service_id": str(service.id), "user_id": str(principal.user_id)},
        )
        return ServiceResponse.model_validate(service)

    async def update_service(
        self, principal: Principal, service_id: uuid.UUID, request: ServiceUpdateRequest
    ) -> ServiceResponse:
        service = await self._require_service(service_id)
        changes = request.model_dump(exclude_unset=True, exclude_none=True)
        for field_name, value in changes.items():
            setattr(service, field_name, value)
        if service.degraded_threshold_ms > service.timeout_ms:
            raise ValidationFailedError("degraded_threshold_ms", "must not exceed timeout_ms")

        await self.session.commit()
        await self.session.refresh(service)
        logger.info(
            "monitored service updated",
            extra={
                "service_id": str(service_id),
                "user_id": str(principal.user_id),
                "fields": sorted(changes),
            },
        )
        return ServiceResponse.model_validate(service)

    async def run_check(self, principal: Principal, service_id: uuid.UUID) -> RunChecksResponse:
        service = await self._require_service(service_id)
        if not service.is_enabled:
            raise ConflictError("SERVICE_DISABLED", "This service is disabled. Enable it before checking.")
        return await self._run_and_store([service], principal)

    async def run_all_checks(self, principal: Principal) -> RunChecksResponse:
        services = await self.services.list_enabled_services()
        return await self._run_and_store(services, principal)

    async def list_check_history(self, service_id: uuid.UUID | None, limit: int) -> list[CheckResultResponse]:
        if service_id is not None:
            await self._require_service(service_id)
        checks = await self.services.list_check_results(service_id, limit)
        return [CheckResultResponse.model_validate(check) for check in checks]

    async def _run_and_store(
        self, services: list[MonitoredService], principal: Principal
    ) -> RunChecksResponse:
        # 1. Run the HTTP checks concurrently (the checker limits concurrency).
        outcomes = await asyncio.gather(
            *(
                self.health_checker.check(
                    service.target_url,
                    service.expected_status_code,
                    service.timeout_ms,
                    service.degraded_threshold_ms,
                )
                for service in services
            )
        )

        # 2. Store results (one DB session is not safe for concurrent use, so sequentially).
        stored_results: list[CheckResult] = []
        incidents_opened = 0
        for service, outcome in zip(services, outcomes, strict=True):
            check_result = CheckResult(
                service_id=service.id,
                status=outcome.status,
                http_status_code=outcome.http_status_code,
                latency_ms=outcome.latency_ms,
                error_code=outcome.error_code,
                error_message=outcome.error_message,
                triggered_by=principal.user_id,
            )
            self.services.add_check_result(check_result)
            stored_results.append(check_result)
            if outcome.status == "down" and await self._open_automatic_incident(service, outcome):
                incidents_opened += 1

        await self.session.commit()
        for check_result in stored_results:
            await self.session.refresh(check_result)

        logger.info(
            "health checks executed",
            extra={
                "user_id": str(principal.user_id),
                "service_count": len(services),
                "down_count": sum(1 for outcome in outcomes if outcome.status == "down"),
                "incidents_opened": incidents_opened,
            },
        )
        return RunChecksResponse(
            results=[CheckResultResponse.model_validate(check) for check in stored_results],
            incidents_opened=incidents_opened,
        )

    async def _open_automatic_incident(self, service: MonitoredService, outcome: CheckOutcome) -> bool:
        # Someone is already handling this service (manual or automatic incident): do not duplicate.
        if await self.incidents.has_unresolved_incident_for_service(service.id):
            return False
        incident_id = await self.incidents.open_automatic_incident_if_absent(
            service_id=service.id,
            reference=generate_reference("INC"),
            title=f"{service.name} is down"[:120],
            description=f"Opened automatically after a failed health check ({outcome.error_code}): "
            f"{outcome.error_message or ''}"[:2000],
            severity="high",
        )
        if incident_id is None:
            return False
        self.incidents.add_event(
            IncidentEvent(
                incident_id=incident_id,
                event_type="created",
                to_status="open",
                note=f"Opened automatically: {outcome.error_code}",
            )
        )
        logger.warning(
            "automatic incident opened",
            extra={"incident_id": str(incident_id), "service_id": str(service.id)},
        )
        return True

    async def _require_service(self, service_id: uuid.UUID) -> MonitoredService:
        service = await self.services.get_service(service_id)
        if service is None:
            raise NotFoundError("SERVICE_NOT_FOUND", "Monitored service not found.")
        return service


def _to_check_response(check: CheckResult | None) -> CheckResultResponse | None:
    return CheckResultResponse.model_validate(check) if check is not None else None
