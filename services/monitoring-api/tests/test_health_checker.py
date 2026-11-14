"""Health checker tests against a real local HTTP server (no database)."""

from __future__ import annotations

import asyncio
import ipaddress
import time

import pytest

from app.security.ssrf import IPAddress, TargetPolicy
from app.services.health_checker import HealthChecker
from tests.conftest import TargetServer


def make_checker(
    target_server: TargetServer,
    allow_private_network: bool = True,
    max_concurrent_checks: int = 5,
    resolver: object = None,
) -> HealthChecker:
    policy = TargetPolicy(
        [target_server.origin, "http://rebind.example.test:" + str(target_server.port)],
        allow_private_network=allow_private_network,
    )
    if resolver is None:
        return HealthChecker(policy, max_concurrent_checks, max_response_bytes=64 * 1024, max_redirects=2)
    return HealthChecker(
        policy, max_concurrent_checks, max_response_bytes=64 * 1024, max_redirects=2, resolver=resolver
    )  # type: ignore[arg-type]


async def run_check(
    checker: HealthChecker,
    url: str,
    expected_status_code: int = 200,
    timeout_ms: int = 2000,
    degraded_threshold_ms: int = 1000,
):  # type: ignore[no-untyped-def]
    return await checker.check(url, expected_status_code, timeout_ms, degraded_threshold_ms)


async def test_healthy_service_is_up(target_server: TargetServer) -> None:
    outcome = await run_check(make_checker(target_server), target_server.url("/ok"))
    assert outcome.status == "up"
    assert outcome.http_status_code == 200
    assert outcome.error_code is None
    assert outcome.latency_ms is not None


async def test_expected_status_code_is_respected(target_server: TargetServer) -> None:
    outcome = await run_check(
        make_checker(target_server), target_server.url("/created"), expected_status_code=201
    )
    assert outcome.status == "up"


async def test_unexpected_status_is_down(target_server: TargetServer) -> None:
    outcome = await run_check(make_checker(target_server), target_server.url("/error"))
    assert outcome.status == "down"
    assert outcome.http_status_code == 503
    assert outcome.error_code == "UNEXPECTED_STATUS"


async def test_slow_response_is_degraded(target_server: TargetServer) -> None:
    outcome = await run_check(
        make_checker(target_server), target_server.url("/slow"), degraded_threshold_ms=200
    )
    assert outcome.status == "degraded"
    assert outcome.error_code == "SLOW_RESPONSE"


async def test_timeout_is_enforced(target_server: TargetServer) -> None:
    started_at = time.perf_counter()
    outcome = await run_check(
        make_checker(target_server), target_server.url("/slow"), timeout_ms=200, degraded_threshold_ms=100
    )
    assert outcome.status == "down"
    assert outcome.error_code == "TIMEOUT"
    assert time.perf_counter() - started_at < 0.5


@pytest.mark.parametrize("path", ["/big-declared", "/big-streamed"])
async def test_oversized_responses_are_cut_off(target_server: TargetServer, path: str) -> None:
    outcome = await run_check(make_checker(target_server), target_server.url(path))
    assert outcome.status == "down"
    assert outcome.error_code == "RESPONSE_TOO_LARGE"


async def test_redirect_within_allowlist_is_followed(target_server: TargetServer) -> None:
    outcome = await run_check(make_checker(target_server), target_server.url("/redirect-ok"))
    assert outcome.status == "up"


@pytest.mark.parametrize("path", ["/redirect-metadata", "/redirect-other-port"])
async def test_redirect_outside_allowlist_is_blocked(target_server: TargetServer, path: str) -> None:
    outcome = await run_check(make_checker(target_server), target_server.url(path))
    assert outcome.status == "down"
    assert outcome.error_code == "REDIRECT_BLOCKED"


async def test_redirect_loop_is_limited(target_server: TargetServer) -> None:
    outcome = await run_check(make_checker(target_server), target_server.url("/redirect-loop"))
    assert outcome.status == "down"
    assert outcome.error_code == "TOO_MANY_REDIRECTS"


async def test_loopback_blocked_when_private_network_not_allowed(target_server: TargetServer) -> None:
    outcome = await run_check(
        make_checker(target_server, allow_private_network=False), target_server.url("/ok")
    )
    assert outcome.status == "down"
    assert outcome.error_code == "TARGET_BLOCKED"


async def test_url_not_in_allowlist_is_blocked(target_server: TargetServer) -> None:
    outcome = await run_check(make_checker(target_server), "http://169.254.169.254/latest/meta-data/")
    assert outcome.status == "down"
    assert outcome.error_code == "TARGET_BLOCKED"


async def test_dns_rebinding_to_metadata_address_is_blocked(target_server: TargetServer) -> None:
    """An allowlisted host name whose DNS suddenly points at the metadata service."""

    async def malicious_resolver(host: str, port: int) -> list[IPAddress]:
        return [ipaddress.ip_address("169.254.169.254")]

    checker = make_checker(target_server, resolver=malicious_resolver)
    outcome = await run_check(checker, f"http://rebind.example.test:{target_server.port}/ok")
    assert outcome.status == "down"
    assert outcome.error_code == "TARGET_BLOCKED"


async def test_mixed_dns_answers_are_blocked(target_server: TargetServer) -> None:
    """Every resolved address must be safe, not just the first one."""

    async def mixed_resolver(host: str, port: int) -> list[IPAddress]:
        return [ipaddress.ip_address("93.184.215.14"), ipaddress.ip_address("10.0.0.7")]

    checker = make_checker(target_server, allow_private_network=False, resolver=mixed_resolver)
    outcome = await run_check(checker, f"http://rebind.example.test:{target_server.port}/ok")
    assert outcome.error_code == "TARGET_BLOCKED"


async def test_request_is_pinned_to_the_validated_address(target_server: TargetServer) -> None:
    """The allowlisted name resolves (via our resolver) to 127.0.0.1; the request must go there,
    while still sending the original Host header."""

    async def pinned_resolver(host: str, port: int) -> list[IPAddress]:
        return [ipaddress.ip_address("127.0.0.1")]

    checker = make_checker(target_server, resolver=pinned_resolver)
    outcome = await run_check(checker, f"http://rebind.example.test:{target_server.port}/echo-host")
    assert outcome.status == "up"


async def test_dns_failure_is_reported(target_server: TargetServer) -> None:
    async def failing_resolver(host: str, port: int) -> list[IPAddress]:
        raise OSError("name resolution failed")

    checker = make_checker(target_server, resolver=failing_resolver)
    outcome = await run_check(checker, f"http://rebind.example.test:{target_server.port}/ok")
    assert outcome.error_code == "DNS_RESOLUTION_FAILED"


async def test_connection_refused_is_reported() -> None:
    policy = TargetPolicy(["http://127.0.0.1:1"], allow_private_network=True)
    checker = HealthChecker(policy, 5, max_response_bytes=1024, max_redirects=0)
    outcome = await checker.check("http://127.0.0.1:1/health", 200, 1000, 500)
    assert outcome.status == "down"
    assert outcome.error_code == "CONNECTION_FAILED"


async def test_concurrency_is_limited(target_server: TargetServer) -> None:
    """6 slow checks (0.6 s each) with a limit of 2 need at least 3 rounds."""
    checker = make_checker(target_server, max_concurrent_checks=2)
    started_at = time.perf_counter()
    outcomes = await asyncio.gather(
        *(run_check(checker, target_server.url("/slow"), degraded_threshold_ms=5000) for _ in range(6))
    )
    elapsed_seconds = time.perf_counter() - started_at
    assert all(outcome.status == "up" for outcome in outcomes)
    assert elapsed_seconds >= 1.7
