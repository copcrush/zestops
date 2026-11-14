"""Shared pytest fixtures.

Database tests need (from the environment or services/monitoring-api/.env):
  TEST_DATABASE_URL        application role on the test database
  TEST_OWNER_DATABASE_URL  owner role, used only to clean tables between tests
Start the database with `docker compose up -d` from the repository root.
"""

from __future__ import annotations

import base64
import os
import threading
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from dotenv import dotenv_values
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import Settings
from app.main import create_app

ENV_FILE_VALUES = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
TEST_ISSUER = "zestops-web"
TEST_AUDIENCE = "zestops-monitoring-api"


def read_setting(name: str) -> str | None:
    return os.environ.get(name) or ENV_FILE_VALUES.get(name)


# ------------------------------------------------------------- test server ---
class _TargetHandler(BaseHTTPRequestHandler):
    """A tiny HTTP server that plays different 'monitored services'."""

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002  (stdlib signature)
        return

    def do_GET(self) -> None:
        routes = {
            "/ok": lambda: self._respond(200, b"ok"),
            "/created": lambda: self._respond(201, b"created"),
            "/error": lambda: self._respond(503, b"unavailable"),
            "/slow": self._slow,
            "/big-declared": lambda: self._respond(200, b"x" * (200 * 1024)),
            "/big-streamed": self._big_streamed,
            "/redirect-ok": lambda: self._redirect("/ok"),
            "/redirect-metadata": lambda: self._redirect("http://169.254.169.254/latest/meta-data/"),
            "/redirect-other-port": lambda: self._redirect("http://127.0.0.1:1/ok"),
            "/redirect-loop": lambda: self._redirect("/redirect-loop"),
            "/echo-host": lambda: self._respond(200, (self.headers.get("Host") or "").encode()),
        }
        routes.get(self.path, lambda: self._respond(404, b"not found"))()

    def _respond(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _slow(self) -> None:
        time.sleep(0.6)
        self._respond(200, b"slow")

    def _big_streamed(self) -> None:
        # No Content-Length: the checker must count bytes while reading.
        self.send_response(200)
        self.send_header("Connection", "close")
        self.end_headers()
        for _ in range(50):
            self.wfile.write(b"y" * 8192)


class _QuietServer(ThreadingHTTPServer):
    def handle_error(self, request: object, client_address: object) -> None:
        # The checker deliberately closes connections early (size limits, timeouts).
        return


@dataclass(frozen=True)
class TargetServer:
    port: int

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def url(self, path: str) -> str:
        return f"{self.origin}{path}"


@pytest.fixture(scope="session")
def target_server() -> Iterator[TargetServer]:
    server = _QuietServer(("127.0.0.1", 0), _TargetHandler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield TargetServer(port=server.server_address[1])
    server.shutdown()


# ------------------------------------------------------------------- keys ---
@pytest.fixture(scope="session")
def signing_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


@pytest.fixture(scope="session")
def public_key_base64(signing_key: Ed25519PrivateKey) -> str:
    pem = signing_key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    return base64.b64encode(pem).decode()


@dataclass(frozen=True)
class ApiUser:
    user_id: uuid.UUID
    role: str


class TokenFactory:
    def __init__(self, signing_key: Ed25519PrivateKey) -> None:
        self.signing_key = signing_key

    def create(self, user: ApiUser, **overrides: object) -> str:
        now = int(time.time())
        claims: dict[str, object] = {
            "iss": TEST_ISSUER,
            "aud": TEST_AUDIENCE,
            "sub": str(user.user_id),
            "role": user.role,
            "iat": now,
            "nbf": now,
            "exp": now + 120,
            "jti": str(uuid.uuid4()),
        }
        claims.update(overrides)
        return jwt.encode(claims, self.signing_key, algorithm="EdDSA")

    def headers(self, user: ApiUser) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.create(user)}"}


@pytest.fixture(scope="session")
def tokens(signing_key: Ed25519PrivateKey) -> TokenFactory:
    return TokenFactory(signing_key)


@pytest.fixture
def admin() -> ApiUser:
    return ApiUser(uuid.uuid4(), "admin")


@pytest.fixture
def viewer() -> ApiUser:
    return ApiUser(uuid.uuid4(), "viewer")


# --------------------------------------------------------------- database ---
@pytest.fixture(scope="session")
def database_urls() -> tuple[str, str]:
    application_url = read_setting("TEST_DATABASE_URL")
    owner_url = read_setting("TEST_OWNER_DATABASE_URL")
    if not application_url or not owner_url:
        if os.environ.get("REQUIRE_INTEGRATION_TESTS") == "true":
            pytest.fail("TEST_DATABASE_URL and TEST_OWNER_DATABASE_URL are required")
        pytest.skip("database tests need TEST_DATABASE_URL and TEST_OWNER_DATABASE_URL (see docs/TESTING.md)")
    return application_url, owner_url


@pytest.fixture(scope="session")
async def owner_engine(database_urls: tuple[str, str]) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(database_urls[1])
    yield engine
    await engine.dispose()


@pytest.fixture
async def clean_database(owner_engine: AsyncEngine) -> None:
    async with owner_engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE monitoring.incident_events, monitoring.incidents, monitoring.check_results, "
                "monitoring.services RESTART IDENTITY CASCADE"
            )
        )


def build_settings(
    database_url: str, public_key_base64: str, target_server: TargetServer, **overrides: object
) -> Settings:
    values: dict[str, object] = {
        "app_env": "test",
        "database_url": database_url,
        "internal_jwt_issuer": TEST_ISSUER,
        "internal_jwt_audience": TEST_AUDIENCE,
        "internal_jwt_public_key_base64": public_key_base64,
        "monitoring_allowed_targets": target_server.origin,
        "monitoring_allow_private_network_targets": True,
        "demo_endpoints_enabled": True,
        "rate_limit_requests_per_minute": 10000,
        "log_level": "WARNING",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@pytest.fixture(scope="session")
def app(database_urls: tuple[str, str], public_key_base64: str, target_server: TargetServer) -> FastAPI:
    return create_app(build_settings(database_urls[0], public_key_base64, target_server))


@pytest.fixture
async def client(app: FastAPI, clean_database: None) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as test_client:
        yield test_client
