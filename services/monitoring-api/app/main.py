"""Application factory: builds the FastAPI app with all routers and middleware.

Run locally:   uv run uvicorn app.main:create_app --factory --reload --port 8000
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import demo, health, incidents, services, summary
from app.core.config import Settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.core.rate_limit import RateLimiter
from app.db import create_engine, create_session_factory
from app.security.auth import TokenVerifier
from app.security.ssrf import TargetPolicy
from app.services.health_checker import HealthChecker

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, health_checker: HealthChecker | None = None) -> FastAPI:
    settings = settings or Settings()  # values come from environment variables / .env
    configure_logging(settings.log_level)

    engine = create_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info("monitoring-api starting", extra={"environment": settings.app_env})
        if settings.is_production and settings.monitoring_allow_private_network_targets:
            logger.warning("MONITORING_ALLOW_PRIVATE_NETWORK_TARGETS is enabled in production")
        yield
        await engine.dispose()
        logger.info("monitoring-api stopped")

    # Interactive API docs are useful locally but not exposed in production.
    app = FastAPI(
        title="ZestOps Monitoring API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    target_policy = TargetPolicy(
        settings.allowed_target_origins, settings.monitoring_allow_private_network_targets
    )
    app.state.settings = settings
    app.state.session_factory = create_session_factory(engine)
    app.state.token_verifier = TokenVerifier(
        settings.jwt_public_key, settings.internal_jwt_issuer, settings.internal_jwt_audience
    )
    app.state.target_policy = target_policy
    app.state.health_checker = health_checker or HealthChecker(
        target_policy,
        max_concurrent_checks=settings.monitoring_max_concurrent_checks,
        max_response_bytes=settings.monitoring_max_response_bytes,
        max_redirects=settings.monitoring_max_redirects,
    )
    app.state.rate_limiter = RateLimiter(settings.rate_limit_requests_per_minute)

    register_exception_handlers(app)
    app.add_middleware(RequestContextMiddleware, is_production=settings.is_production)

    app.include_router(health.router)
    if settings.demo_endpoints_enabled:
        app.include_router(demo.router)
    app.include_router(services.router)
    app.include_router(incidents.router)
    app.include_router(summary.router)
    return app
