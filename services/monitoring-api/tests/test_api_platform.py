"""Cross-cutting API behaviour: health, headers, errors, limits, summary."""

from __future__ import annotations

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from tests.conftest import ApiUser, TargetServer, TokenFactory, build_settings


async def test_health_endpoints(client: AsyncClient) -> None:
    assert (await client.get("/health/live")).json() == {"status": "ok"}
    ready = await client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json() == {"status": "ok", "checks": {"database": "ok"}}


async def test_security_headers_and_request_ids(client: AsyncClient) -> None:
    response = await client.get("/v1/services", headers={"X-Correlation-ID": "web-abc-123"})
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["cache-control"] == "no-store"
    assert "access-control-allow-origin" not in response.headers
    assert response.headers["x-correlation-id"] == "web-abc-123"
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]


async def test_unsafe_correlation_id_is_replaced(client: AsyncClient) -> None:
    response = await client.get("/health/live", headers={"X-Correlation-ID": "a" * 100})
    assert response.headers["x-correlation-id"] == response.headers["x-request-id"]


async def test_unknown_route_uses_error_envelope(client: AsyncClient) -> None:
    response = await client.get("/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


async def test_oversized_body_is_rejected(client: AsyncClient, tokens: TokenFactory, admin: ApiUser) -> None:
    response = await client.post(
        "/v1/incidents",
        content=b"{" + b" " * (70 * 1024) + b"}",
        headers=tokens.headers(admin) | {"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


async def test_invalid_json_body(client: AsyncClient, tokens: TokenFactory, admin: ApiUser) -> None:
    response = await client.post(
        "/v1/incidents",
        content=b"{not json",
        headers=tokens.headers(admin) | {"Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_demo_endpoint_is_unavailable(client: AsyncClient) -> None:
    response = await client.get("/demo/unstable")
    assert response.status_code == 503


async def test_rate_limit_per_user(
    database_urls: tuple[str, str],
    public_key_base64: str,
    target_server: TargetServer,
    tokens: TokenFactory,
    admin: ApiUser,
    viewer: ApiUser,
) -> None:
    limited_app: FastAPI = create_app(
        build_settings(database_urls[0], public_key_base64, target_server, rate_limit_requests_per_minute=3)
    )
    async with AsyncClient(transport=ASGITransport(app=limited_app), base_url="http://testserver") as client:
        status_codes = [
            (await client.get("/v1/monitoring/summary", headers=tokens.headers(admin))).status_code
            for _ in range(5)
        ]
        other_user = await client.get("/v1/monitoring/summary", headers=tokens.headers(viewer))
        limited = await client.get("/v1/monitoring/summary", headers=tokens.headers(admin))

    assert status_codes == [200, 200, 200, 429, 429]
    assert other_user.status_code == 200, "limits are per user"
    assert limited.json()["error"]["code"] == "RATE_LIMITED"
    assert int(limited.headers["retry-after"]) >= 1


async def test_production_hides_docs_and_demo(
    database_urls: tuple[str, str], public_key_base64: str, target_server: TargetServer
) -> None:
    production_app = create_app(
        build_settings(
            database_urls[0],
            public_key_base64,
            target_server,
            app_env="production",
            demo_endpoints_enabled=False,
        )
    )
    async with AsyncClient(
        transport=ASGITransport(app=production_app), base_url="http://testserver"
    ) as client:
        assert (await client.get("/docs")).status_code == 404
        assert (await client.get("/openapi.json")).status_code == 404
        assert (await client.get("/demo/unstable")).status_code == 404
        assert "strict-transport-security" in (await client.get("/health/live")).headers


async def test_monitoring_summary(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    for name, path in [("Healthy", "/ok"), ("Broken", "/error")]:
        await client.post(
            "/v1/services",
            json={"name": name, "target_url": target_server.url(path)},
            headers=tokens.headers(admin),
        )
    await client.post("/v1/checks/run", headers=tokens.headers(admin))
    await client.post(
        "/v1/incidents", json={"title": "Manual one", "severity": "critical"}, headers=tokens.headers(admin)
    )

    summary = (await client.get("/v1/monitoring/summary", headers=tokens.headers(admin))).json()["data"]

    assert summary["total_services"] == 2
    assert summary["services_by_status"] == {"up": 1, "degraded": 0, "down": 1, "unknown": 0}
    assert summary["open_incidents"] == 2
    assert summary["open_incidents_by_severity"] == {"critical": 1, "high": 1, "medium": 0, "low": 0}
    assert summary["checks_last_24_hours"] == 2
    assert summary["overall_uptime_percent_24h"] == 50.0
