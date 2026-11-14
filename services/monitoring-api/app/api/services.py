"""HTTP entry points for monitored services and health checks (/v1/services, /v1/checks)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.dependencies import (
    AdminPrincipal,
    CurrentPrincipal,
    DatabaseSession,
    HealthCheckerDependency,
    TargetPolicyDependency,
)
from app.schemas.services import (
    CheckResultResponse,
    RunChecksResponse,
    ServiceCreateRequest,
    ServiceDetailResponse,
    ServiceResponse,
    ServiceUpdateRequest,
    ServiceWithLatestCheckResponse,
)
from app.services.monitoring_service import MonitoringService

router = APIRouter(prefix="/v1", tags=["monitoring"])


def _monitoring_service(
    session: DatabaseSession, target_policy: TargetPolicyDependency, health_checker: HealthCheckerDependency
) -> MonitoringService:
    return MonitoringService(session, target_policy, health_checker)


@router.get("/services")
async def list_services(
    principal: CurrentPrincipal,
    session: DatabaseSession,
    target_policy: TargetPolicyDependency,
    health_checker: HealthCheckerDependency,
) -> dict[str, list[ServiceWithLatestCheckResponse]]:
    service = _monitoring_service(session, target_policy, health_checker)
    return {"data": await service.list_services()}


@router.post("/services", status_code=201)
async def register_service(
    request: ServiceCreateRequest,
    principal: AdminPrincipal,
    session: DatabaseSession,
    target_policy: TargetPolicyDependency,
    health_checker: HealthCheckerDependency,
) -> dict[str, ServiceResponse]:
    service = _monitoring_service(session, target_policy, health_checker)
    return {"data": await service.register_service(principal, request)}


@router.get("/services/{service_id}")
async def get_service(
    service_id: uuid.UUID,
    principal: CurrentPrincipal,
    session: DatabaseSession,
    target_policy: TargetPolicyDependency,
    health_checker: HealthCheckerDependency,
) -> dict[str, ServiceDetailResponse]:
    service = _monitoring_service(session, target_policy, health_checker)
    return {"data": await service.get_service_detail(service_id)}


@router.patch("/services/{service_id}")
async def update_service(
    service_id: uuid.UUID,
    request: ServiceUpdateRequest,
    principal: AdminPrincipal,
    session: DatabaseSession,
    target_policy: TargetPolicyDependency,
    health_checker: HealthCheckerDependency,
) -> dict[str, ServiceResponse]:
    service = _monitoring_service(session, target_policy, health_checker)
    return {"data": await service.update_service(principal, service_id, request)}


@router.post("/services/{service_id}/checks")
async def run_service_check(
    service_id: uuid.UUID,
    principal: AdminPrincipal,
    session: DatabaseSession,
    target_policy: TargetPolicyDependency,
    health_checker: HealthCheckerDependency,
) -> dict[str, RunChecksResponse]:
    service = _monitoring_service(session, target_policy, health_checker)
    return {"data": await service.run_check(principal, service_id)}


@router.post("/checks/run")
async def run_all_checks(
    principal: AdminPrincipal,
    session: DatabaseSession,
    target_policy: TargetPolicyDependency,
    health_checker: HealthCheckerDependency,
) -> dict[str, RunChecksResponse]:
    service = _monitoring_service(session, target_policy, health_checker)
    return {"data": await service.run_all_checks(principal)}


@router.get("/checks")
async def list_check_history(
    principal: CurrentPrincipal,
    session: DatabaseSession,
    target_policy: TargetPolicyDependency,
    health_checker: HealthCheckerDependency,
    service_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, list[CheckResultResponse]]:
    service = _monitoring_service(session, target_policy, health_checker)
    return {"data": await service.list_check_history(service_id, limit)}


@router.get("/allowed-targets")
async def list_allowed_targets(
    principal: AdminPrincipal, target_policy: TargetPolicyDependency
) -> dict[str, list[str]]:
    """Origins an admin may register (helps the UI explain the SSRF allowlist)."""
    return {"data": sorted(str(origin) for origin in target_policy.allowed_origins)}
