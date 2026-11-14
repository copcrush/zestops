"""Verification of the internal JWT that the web BFF signs for each request.

Enforced rules (same as the Go Payment API, see docs/architecture/AUTH.md):
- only EdDSA (Ed25519) is accepted; "none", HS256, RS256 ... are rejected
- signature, issuer, audience, expiry, not-before and issued-at are verified
- token lifetime is at most 5 minutes
- subject must be a UUID and role must be "admin" or "viewer"

The service never trusts a role or user ID sent any other way.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Literal

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

logger = logging.getLogger(__name__)

Role = Literal["admin", "viewer"]
ALLOWED_ROLES: frozenset[str] = frozenset({"admin", "viewer"})
MAXIMUM_TOKEN_LIFETIME_SECONDS = 5 * 60
CLOCK_SKEW_LEEWAY_SECONDS = 30


class InvalidTokenError(Exception):
    """The token failed verification. The message is for logs only."""


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    role: Role

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


class TokenVerifier:
    def __init__(self, public_key: Ed25519PublicKey, issuer: str, audience: str) -> None:
        self._public_key = public_key
        self._issuer = issuer
        self._audience = audience

    def verify(self, raw_token: str) -> Principal:
        try:
            claims = jwt.decode(
                raw_token,
                key=self._public_key,
                algorithms=["EdDSA"],
                audience=self._audience,
                issuer=self._issuer,
                leeway=CLOCK_SKEW_LEEWAY_SECONDS,
                options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            )
        except jwt.PyJWTError as error:
            raise InvalidTokenError(f"{type(error).__name__}: {error}") from error

        issued_at, expires_at = claims["iat"], claims["exp"]
        if not isinstance(issued_at, int | float) or not isinstance(expires_at, int | float):
            raise InvalidTokenError("iat and exp must be numeric")
        if expires_at - issued_at > MAXIMUM_TOKEN_LIFETIME_SECONDS:
            raise InvalidTokenError("token lifetime exceeds the maximum")

        try:
            user_id = uuid.UUID(str(claims["sub"]))
        except ValueError as error:
            raise InvalidTokenError("subject is not a UUID") from error

        role = claims.get("role")
        if role == "admin":
            return Principal(user_id=user_id, role="admin")
        if role == "viewer":
            return Principal(user_id=user_id, role="viewer")
        raise InvalidTokenError(f"unknown role {role!r}")
