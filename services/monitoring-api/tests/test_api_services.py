"""API tests for monitored services and checks (real PostgreSQL)."""

from __future__ import annotations

import asyncio

from httpx import AsyncClient

from tests.conftest import ApiUser, TargetServer, TokenFactory


def service_body(
    target_server: TargetServer, path: str = "/ok", name: str = "Payment API"
) -> dict[str, object]:
    return {
        "name": name,
        "description": "Test service",
        "target_url": target_server.url(path),
        "expected_status_code": 200,
        "timeout_ms": 2000,
        "degraded_threshold_ms": 1000,
    }


async def register(client: AsyncClient, tokens: TokenFactory, admin: ApiUser, body: dict[str, object]) -> str:
    response = await client.post("/v1/services", json=body, headers=tokens.headers(admin))
    assert response.status_code == 201, response.text
    service_id: str = response.json()["data"]["id"]
    return service_id


async def test_endpoints_require_authentication(client: AsyncClient) -> None:
    for method, path in [
        ("GET", "/v1/services"),
        ("POST", "/v1/services"),
        ("POST", "/v1/checks/run"),
        ("GET", "/v1/checks"),
        ("GET", "/v1/monitoring/summary"),
        ("GET", "/v1/incidents"),
    ]:
        response = await client.request(method, path)
        assert response.status_code == 401, (method, path)
        assert response.json()["error"]["code"] == "UNAUTHENTICATED"


async def test_expired_or_foreign_tokens_are_rejected(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser
) -> None:
    expired = tokens.create(admin, iat=1_700_000_000, exp=1_700_000_060)
    payment_api_token = tokens.create(admin, aud="zestops-payment-api")
    for token in (expired, payment_api_token):
        response = await client.get("/v1/services", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 401


async def test_viewer_can_read_but_not_change(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, viewer: ApiUser, target_server: TargetServer
) -> None:
    service_id = await register(client, tokens, admin, service_body(target_server))

    for path in ["/v1/services", f"/v1/services/{service_id}", "/v1/checks", "/v1/monitoring/summary"]:
        assert (await client.get(path, headers=tokens.headers(viewer))).status_code == 200, path

    forbidden_requests = [
        ("POST", "/v1/services", service_body(target_server, name="Other")),
        ("PATCH", f"/v1/services/{service_id}", {"is_enabled": False}),
        ("POST", f"/v1/services/{service_id}/checks", None),
        ("POST", "/v1/checks/run", None),
        ("GET", "/v1/allowed-targets", None),
    ]
    for method, path, body in forbidden_requests:
        response = await client.request(method, path, json=body, headers=tokens.headers(viewer))
        assert response.status_code == 403, (method, path)
        assert response.json()["error"]["code"] == "FORBIDDEN"


async def test_register_service(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    response = await client.post(
        "/v1/services", json=service_body(target_server), headers=tokens.headers(admin)
    )

    assert response.status_code == 201
    service = response.json()["data"]
    assert service["name"] == "Payment API"
    assert service["created_by"] == str(admin.user_id)
    assert service["is_enabled"] is True
    assert service["is_demo_seed"] is False


async def test_register_rejects_targets_outside_allowlist(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    for target_url in [
        "http://169.254.169.254/latest/meta-data/",
        "http://evil.example.com/",
        f"http://127.0.0.1:{target_server.port + 1}/ok",
        "file:///etc/passwd",
        f"http://admin:secret@127.0.0.1:{target_server.port}/ok",
    ]:
        body = service_body(target_server) | {"target_url": target_url}
        response = await client.post("/v1/services", json=body, headers=tokens.headers(admin))
        assert response.status_code == 400, target_url
        assert response.json()["error"]["details"][0]["field"] == "target_url"
    services = (await client.get("/v1/services", headers=tokens.headers(admin))).json()["data"]
    assert services == []


async def test_register_validation(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    invalid_bodies = [
        service_body(target_server) | {"unexpected_field": True},
        service_body(target_server) | {"timeout_ms": 50},
        service_body(target_server) | {"timeout_ms": "2000"},
        service_body(target_server) | {"degraded_threshold_ms": 5000, "timeout_ms": 1000},
        service_body(target_server) | {"name": ""},
        service_body(target_server) | {"name": "bad\x00name"},
        service_body(target_server) | {"expected_status_code": 700},
    ]
    for body in invalid_bodies:
        response = await client.post("/v1/services", json=body, headers=tokens.headers(admin))
        assert response.status_code == 400, body
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_duplicate_service_name_conflicts(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    await register(client, tokens, admin, service_body(target_server))
    response = await client.post(
        "/v1/services", json=service_body(target_server), headers=tokens.headers(admin)
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SERVICE_NAME_TAKEN"


async def test_run_check_stores_history(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    service_id = await register(client, tokens, admin, service_body(target_server))

    response = await client.post(f"/v1/services/{service_id}/checks", headers=tokens.headers(admin))

    assert response.status_code == 200, response.text
    result = response.json()["data"]["results"][0]
    assert result["status"] == "up"
    assert result["triggered_by"] == str(admin.user_id)
    detail = (await client.get(f"/v1/services/{service_id}", headers=tokens.headers(admin))).json()["data"]
    assert detail["latest_check"]["status"] == "up"
    assert detail["uptime_percent_24h"] == 100.0
    assert len(detail["recent_checks"]) == 1


async def test_failed_checks_open_exactly_one_automatic_incident(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    service_id = await register(client, tokens, admin, service_body(target_server, path="/error"))

    # Several failing checks, some of them concurrent.
    first = await client.post(f"/v1/services/{service_id}/checks", headers=tokens.headers(admin))
    concurrent = await asyncio.gather(
        *(client.post(f"/v1/services/{service_id}/checks", headers=tokens.headers(admin)) for _ in range(4))
    )

    assert first.json()["data"]["incidents_opened"] == 1
    assert all(response.status_code == 200 for response in concurrent)
    assert sum(response.json()["data"]["incidents_opened"] for response in concurrent) == 0
    incidents = (await client.get("/v1/incidents", headers=tokens.headers(admin))).json()["data"]
    assert len(incidents) == 1
    assert incidents[0]["source"] == "automatic"
    assert incidents[0]["service_id"] == service_id
    assert incidents[0]["severity"] == "high"


async def test_run_all_checks(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    await register(client, tokens, admin, service_body(target_server, "/ok", "Healthy"))
    await register(client, tokens, admin, service_body(target_server, "/error", "Broken"))
    disabled_id = await register(client, tokens, admin, service_body(target_server, "/ok", "Disabled"))
    await client.patch(
        f"/v1/services/{disabled_id}", json={"is_enabled": False}, headers=tokens.headers(admin)
    )

    response = await client.post("/v1/checks/run", headers=tokens.headers(admin))

    data = response.json()["data"]
    assert sorted(result["status"] for result in data["results"]) == ["down", "up"]
    assert data["incidents_opened"] == 1
    disabled_check = await client.post(f"/v1/services/{disabled_id}/checks", headers=tokens.headers(admin))
    assert disabled_check.status_code == 409
    assert disabled_check.json()["error"]["code"] == "SERVICE_DISABLED"


async def test_update_service(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    service_id = await register(client, tokens, admin, service_body(target_server))

    response = await client.patch(
        f"/v1/services/{service_id}",
        json={"timeout_ms": 5000, "description": "new"},
        headers=tokens.headers(admin),
    )
    assert response.status_code == 200
    assert response.json()["data"]["timeout_ms"] == 5000

    target_change = await client.patch(
        f"/v1/services/{service_id}",
        json={"target_url": "http://evil.example/"},
        headers=tokens.headers(admin),
    )
    assert target_change.status_code == 400, "target_url cannot be changed after registration"

    bad_threshold = await client.patch(
        f"/v1/services/{service_id}", json={"degraded_threshold_ms": 9000}, headers=tokens.headers(admin)
    )
    assert bad_threshold.status_code == 400


async def test_check_history_and_not_found(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    service_id = await register(client, tokens, admin, service_body(target_server))
    for _ in range(3):
        await client.post(f"/v1/services/{service_id}/checks", headers=tokens.headers(admin))

    history = await client.get(f"/v1/checks?service_id={service_id}&limit=2", headers=tokens.headers(admin))
    assert len(history.json()["data"]) == 2

    missing = await client.get(
        "/v1/services/00000000-0000-4000-8000-000000000999", headers=tokens.headers(admin)
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "SERVICE_NOT_FOUND"
    assert (await client.get("/v1/services/not-a-uuid", headers=tokens.headers(admin))).status_code == 400


async def test_allowed_targets_for_admin(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    response = await client.get("/v1/allowed-targets", headers=tokens.headers(admin))
    assert response.json()["data"] == [f"http://127.0.0.1:{target_server.port}"]


async def test_no_automatic_incident_while_a_manual_one_is_unresolved(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, target_server: TargetServer
) -> None:
    service_id = await register(client, tokens, admin, service_body(target_server, path="/error"))
    manual = await client.post(
        "/v1/incidents",
        json={"title": "Known outage", "severity": "medium", "service_id": service_id},
        headers=tokens.headers(admin),
    )
    assert manual.status_code == 201

    check = await client.post(f"/v1/services/{service_id}/checks", headers=tokens.headers(admin))

    assert check.json()["data"]["incidents_opened"] == 0
    incidents = (await client.get("/v1/incidents", headers=tokens.headers(admin))).json()["data"]
    assert [incident["source"] for incident in incidents] == ["manual"]
