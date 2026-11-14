"""API tests for the incident workflow (real PostgreSQL)."""

from __future__ import annotations

import asyncio

from httpx import AsyncClient

from tests.conftest import ApiUser, TokenFactory


async def create_incident(
    client: AsyncClient,
    tokens: TokenFactory,
    admin: ApiUser,
    title: str = "Checkout errors",
    severity: str = "high",
) -> dict[str, object]:
    response = await client.post(
        "/v1/incidents",
        json={"title": title, "description": "Customers see 500s", "severity": severity},
        headers=tokens.headers(admin),
    )
    assert response.status_code == 201, response.text
    incident: dict[str, object] = response.json()["data"]
    return incident


async def test_admin_creates_incident_with_timeline(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser
) -> None:
    incident = await create_incident(client, tokens, admin)

    assert incident["status"] == "open"
    assert incident["source"] == "manual"
    assert incident["created_by"] == str(admin.user_id)
    assert str(incident["reference"]).startswith("INC-")
    events = incident["events"]
    assert isinstance(events, list)
    assert [event["event_type"] for event in events] == ["created"]


async def test_viewer_cannot_create_or_change_incidents(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser, viewer: ApiUser
) -> None:
    incident = await create_incident(client, tokens, admin)
    incident_id = incident["id"]

    assert (
        await client.get(f"/v1/incidents/{incident_id}", headers=tokens.headers(viewer))
    ).status_code == 200
    for path, body in [
        ("/v1/incidents", {"title": "x" * 5, "severity": "low"}),
        (f"/v1/incidents/{incident_id}/status", {"status": "investigating"}),
        (f"/v1/incidents/{incident_id}/notes", {"note": "looking"}),
    ]:
        response = await client.post(path, json=body, headers=tokens.headers(viewer))
        assert response.status_code == 403, path


async def test_full_lifecycle_open_investigating_resolved(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser
) -> None:
    incident_id = (await create_incident(client, tokens, admin))["id"]

    investigating = await client.post(
        f"/v1/incidents/{incident_id}/status",
        json={"status": "investigating", "note": "Checking logs"},
        headers=tokens.headers(admin),
    )
    assert investigating.status_code == 200
    assert investigating.json()["data"]["acknowledged_by"] == str(admin.user_id)

    note = await client.post(
        f"/v1/incidents/{incident_id}/notes",
        json={"note": "Found a bad deploy"},
        headers=tokens.headers(admin),
    )
    assert note.status_code == 201

    resolved = await client.post(
        f"/v1/incidents/{incident_id}/status",
        json={"status": "resolved", "note": "Rolled back to v1.2.3"},
        headers=tokens.headers(admin),
    )
    data = resolved.json()["data"]
    assert data["status"] == "resolved"
    assert data["resolved_by"] == str(admin.user_id)
    assert data["resolution_note"] == "Rolled back to v1.2.3"
    assert [event["event_type"] for event in data["events"]] == [
        "created",
        "status_changed",
        "note_added",
        "status_changed",
    ]


async def test_resolution_requires_a_note(client: AsyncClient, tokens: TokenFactory, admin: ApiUser) -> None:
    incident_id = (await create_incident(client, tokens, admin))["id"]
    response = await client.post(
        f"/v1/incidents/{incident_id}/status", json={"status": "resolved"}, headers=tokens.headers(admin)
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_resolved_incident_is_final(client: AsyncClient, tokens: TokenFactory, admin: ApiUser) -> None:
    incident_id = (await create_incident(client, tokens, admin))["id"]
    await client.post(
        f"/v1/incidents/{incident_id}/status",
        json={"status": "resolved", "note": "Fixed it"},
        headers=tokens.headers(admin),
    )

    reopen = await client.post(
        f"/v1/incidents/{incident_id}/status", json={"status": "investigating"}, headers=tokens.headers(admin)
    )
    assert reopen.status_code == 409
    assert reopen.json()["error"]["code"] == "INVALID_STATE_TRANSITION"
    note = await client.post(
        f"/v1/incidents/{incident_id}/notes", json={"note": "late note"}, headers=tokens.headers(admin)
    )
    assert note.status_code == 409


async def test_concurrent_resolutions_succeed_exactly_once(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser
) -> None:
    incident_id = (await create_incident(client, tokens, admin))["id"]

    responses = await asyncio.gather(
        *(
            client.post(
                f"/v1/incidents/{incident_id}/status",
                json={"status": "resolved", "note": f"Fix {number}"},
                headers=tokens.headers(admin),
            )
            for number in range(8)
        )
    )

    status_codes = sorted(response.status_code for response in responses)
    assert status_codes == [200] + [409] * 7
    detail = (await client.get(f"/v1/incidents/{incident_id}", headers=tokens.headers(admin))).json()["data"]
    assert [event["event_type"] for event in detail["events"]].count("status_changed") == 1


async def test_list_filters_and_pagination(client: AsyncClient, tokens: TokenFactory, admin: ApiUser) -> None:
    for number in range(5):
        await create_incident(
            client, tokens, admin, title=f"Incident {number}", severity="critical" if number == 0 else "low"
        )
    first_incident_id = (
        await client.get("/v1/incidents?severity=critical", headers=tokens.headers(admin))
    ).json()["data"][0]["id"]
    await client.post(
        f"/v1/incidents/{first_incident_id}/status",
        json={"status": "resolved", "note": "done"},
        headers=tokens.headers(admin),
    )

    unresolved = (await client.get("/v1/incidents?status=unresolved", headers=tokens.headers(admin))).json()
    assert len(unresolved["data"]) == 4

    seen_ids: list[str] = []
    cursor = None
    while True:
        query = "/v1/incidents?limit=2" + (f"&cursor={cursor}" if cursor else "")
        page = (await client.get(query, headers=tokens.headers(admin))).json()
        seen_ids.extend(incident["id"] for incident in page["data"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(seen_ids) == 5
    assert len(set(seen_ids)) == 5

    for invalid_query in ["status=closed", "severity=urgent", "limit=0", "limit=500", "cursor=garbage"]:
        response = await client.get(f"/v1/incidents?{invalid_query}", headers=tokens.headers(admin))
        assert response.status_code == 400, invalid_query


async def test_incident_validation_and_not_found(
    client: AsyncClient, tokens: TokenFactory, admin: ApiUser
) -> None:
    invalid_bodies = [
        {"title": "ab", "severity": "low"},
        {"title": "Valid title", "severity": "urgent"},
        {"title": "Valid title", "severity": "low", "status": "resolved"},
        {"title": "Valid title", "severity": "low", "service_id": "00000000-0000-4000-8000-000000000999"},
        {"title": "<script>alert(1)</script>\x07", "severity": "low"},
    ]
    for body in invalid_bodies:
        response = await client.post("/v1/incidents", json=body, headers=tokens.headers(admin))
        assert response.status_code == 400, body

    missing = await client.get(
        "/v1/incidents/00000000-0000-4000-8000-000000000999", headers=tokens.headers(admin)
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "INCIDENT_NOT_FOUND"
