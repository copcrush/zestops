"""Database queries for monitored services and their check history.

All queries are built with SQLAlchemy, which always sends values as bound
parameters (never string concatenation), preventing SQL injection.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CheckResult, MonitoredService


class ServiceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_services(self) -> list[MonitoredService]:
        result = await self.session.scalars(select(MonitoredService).order_by(MonitoredService.name))
        return list(result)

    async def list_enabled_services(self) -> list[MonitoredService]:
        result = await self.session.scalars(
            select(MonitoredService)
            .where(MonitoredService.is_enabled.is_(True))
            .order_by(MonitoredService.name)
        )
        return list(result)

    async def get_service(self, service_id: uuid.UUID) -> MonitoredService | None:
        return await self.session.get(MonitoredService, service_id)

    def add_service(self, service: MonitoredService) -> None:
        self.session.add(service)

    async def latest_check_by_service(self) -> dict[uuid.UUID, CheckResult]:
        """Most recent check of every service (PostgreSQL DISTINCT ON)."""
        result = await self.session.scalars(
            select(CheckResult)
            .ext(distinct_on(CheckResult.service_id))
            .order_by(CheckResult.service_id, CheckResult.checked_at.desc(), CheckResult.id.desc())
        )
        return {check.service_id: check for check in result}

    async def uptime_percent_since(self, since: datetime) -> dict[uuid.UUID, float]:
        """Share of checks that were up or degraded, per service."""
        healthy_checks = func.count().filter(CheckResult.status.in_(["up", "degraded"]))
        result = await self.session.execute(
            select(CheckResult.service_id, healthy_checks, func.count())
            .where(CheckResult.checked_at >= since)
            .group_by(CheckResult.service_id)
        )
        return {
            service_id: round(healthy_count * 100 / total_count, 1)
            for service_id, healthy_count, total_count in result
            if total_count > 0
        }

    async def list_check_results(self, service_id: uuid.UUID | None, limit: int) -> list[CheckResult]:
        statement = (
            select(CheckResult).order_by(CheckResult.checked_at.desc(), CheckResult.id.desc()).limit(limit)
        )
        if service_id is not None:
            statement = statement.where(CheckResult.service_id == service_id)
        return list(await self.session.scalars(statement))

    def add_check_result(self, check_result: CheckResult) -> None:
        self.session.add(check_result)

    async def count_checks_since(self, since: datetime) -> tuple[int, int]:
        """(total checks, healthy checks) since a moment."""
        healthy_checks = func.count().filter(CheckResult.status.in_(["up", "degraded"]))
        row = (
            await self.session.execute(
                select(func.count(), healthy_checks).where(CheckResult.checked_at >= since)
            )
        ).one()
        return int(row[0]), int(row[1])
