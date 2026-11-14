"""FastAPI dependencies: database session, authentication, authorization.

How auth works for a request:
  1. get_principal reads "Authorization: Bearer <internal JWT>" and verifies it.
  2. The per-user rate limit is applied.
  3. require_admin additionally checks the role for write endpoints.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.rate_limit import RateLimiter
from app.security.auth import InvalidTokenError, Principal, TokenVerifier
from app.security.ssrf import TargetPolicy
from app.services.health_checker import HealthChecker

security_logger = logging.getLogger("monitoring_api.security")


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


def get_target_policy(request: Request) -> TargetPolicy:
    target_policy: TargetPolicy = request.app.state.target_policy
    return target_policy


def get_health_checker(request: Request) -> HealthChecker:
    health_checker: HealthChecker = request.app.state.health_checker
    return health_checker


async def get_principal(request: Request) -> Principal:
    scheme, _, raw_token = request.headers.get("authorization", "").partition(" ")
    if scheme != "Bearer" or not raw_token.strip():
        raise AppError(401, "UNAUTHENTICATED", "Authentication is required.")

    token_verifier: TokenVerifier = request.app.state.token_verifier
    try:
        principal = token_verifier.verify(raw_token.strip())
    except InvalidTokenError as error:
        security_logger.warning("internal token rejected", extra={"reason": str(error)})
        raise AppError(401, "UNAUTHENTICATED", "Authentication is required.") from error

    request.state.user_id = str(principal.user_id)

    rate_limiter: RateLimiter = request.app.state.rate_limiter
    retry_after_seconds = rate_limiter.try_acquire(f"user:{principal.user_id}")
    if retry_after_seconds is not None:
        raise AppError(
            429,
            "RATE_LIMITED",
            "Too many requests. Please slow down.",
            headers={"Retry-After": str(int(retry_after_seconds))},
        )
    return principal


async def require_admin(
    request: Request, principal: Annotated[Principal, Depends(get_principal)]
) -> Principal:
    if not principal.is_admin:
        security_logger.warning(
            "authorization denied",
            extra={
                "user_id": str(principal.user_id),
                "role": principal.role,
                "method": request.method,
                "path": request.url.path,
            },
        )
        raise AppError(403, "FORBIDDEN", "You do not have permission to perform this action.")
    return principal


DatabaseSession = Annotated[AsyncSession, Depends(get_session)]
CurrentPrincipal = Annotated[Principal, Depends(get_principal)]
AdminPrincipal = Annotated[Principal, Depends(require_admin)]
TargetPolicyDependency = Annotated[TargetPolicy, Depends(get_target_policy)]
HealthCheckerDependency = Annotated[HealthChecker, Depends(get_health_checker)]
