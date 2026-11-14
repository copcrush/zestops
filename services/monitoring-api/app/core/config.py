"""Application settings loaded from environment variables (and `.env` locally).

Invalid settings stop the service at startup instead of failing at request time.
"""

from __future__ import annotations

import base64
from functools import cached_property
from typing import Literal

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    port: int = Field(default=8000, ge=1, le=65535)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    database_url: str

    internal_jwt_issuer: str = "zestops-web"
    internal_jwt_audience: str = "zestops-monitoring-api"
    internal_jwt_public_key_base64: str

    # SSRF protection: comma-separated origins (scheme://host:port) that may be monitored.
    monitoring_allowed_targets: str = ""
    # Private/loopback addresses are blocked unless this is true (local Docker only).
    monitoring_allow_private_network_targets: bool = False
    monitoring_max_concurrent_checks: int = Field(default=5, ge=1, le=50)
    monitoring_max_response_bytes: int = Field(default=64 * 1024, ge=1024, le=1024 * 1024)
    monitoring_max_redirects: int = Field(default=2, ge=0, le=5)

    demo_endpoints_enabled: bool = False
    rate_limit_requests_per_minute: int = Field(default=120, ge=1, le=10000)

    @field_validator("database_url")
    @classmethod
    def require_asyncpg_driver(cls, value: str) -> str:
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL must start with postgresql+asyncpg://")
        return value

    @field_validator("log_level", mode="before")
    @classmethod
    def uppercase_log_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @cached_property
    def jwt_public_key(self) -> Ed25519PublicKey:
        return parse_ed25519_public_key_base64(self.internal_jwt_public_key_base64)

    @property
    def allowed_target_origins(self) -> list[str]:
        return [origin.strip() for origin in self.monitoring_allowed_targets.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


def parse_ed25519_public_key_base64(encoded_key: str) -> Ed25519PublicKey:
    """Decode a base64-encoded PEM (SPKI) Ed25519 public key."""
    try:
        pem_bytes = base64.b64decode(encoded_key.strip(), validate=True)
        public_key = load_pem_public_key(pem_bytes)
    except ValueError as error:
        raise ValueError("INTERNAL_JWT_PUBLIC_KEY_BASE64 is not a valid base64 PEM public key") from error
    if not isinstance(public_key, Ed25519PublicKey):
        raise ValueError("INTERNAL_JWT_PUBLIC_KEY_BASE64 must be an Ed25519 key")
    return public_key
