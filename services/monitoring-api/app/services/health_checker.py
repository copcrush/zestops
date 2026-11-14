"""Executes a single HTTP health check safely (see app/security/ssrf.py).

Safety limits applied to every check:
- target must be in the allowlist; every resolved IP must pass the IP policy
- the request goes to the validated IP (DNS pinning) with the original Host/SNI
- overall deadline = the service's timeout_ms (DNS + connect + response)
- at most `max_redirects` redirects, each one re-validated
- at most `max_response_bytes` are read (raw bytes, no decompression)
- at most `max_concurrent_checks` checks run at the same time
- environment proxies are ignored (trust_env=False) so pinning cannot be bypassed
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urljoin

import httpx

from app.security.ssrf import IPAddress, TargetNotAllowedError, TargetPolicy, ValidatedTarget

logger = logging.getLogger(__name__)

CheckStatus = Literal["up", "degraded", "down"]
Resolver = Callable[[str, int], Awaitable[list[IPAddress]]]
USER_AGENT = "ZestOps-Monitor/1.0"


@dataclass(frozen=True)
class CheckOutcome:
    status: CheckStatus
    http_status_code: int | None
    latency_ms: int | None
    error_code: str | None
    error_message: str | None


class _CheckFailedError(Exception):
    def __init__(self, error_code: str, message: str) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message


async def resolve_with_system_dns(host: str, port: int) -> list[IPAddress]:
    loop = asyncio.get_running_loop()
    address_infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses: list[IPAddress] = []
    for _family, _type, _protocol, _canonical_name, socket_address in address_infos:
        address = ipaddress.ip_address(str(socket_address[0]).split("%")[0])
        if address not in addresses:
            addresses.append(address)
    return addresses


class HealthChecker:
    def __init__(
        self,
        target_policy: TargetPolicy,
        max_concurrent_checks: int,
        max_response_bytes: int,
        max_redirects: int,
        resolver: Resolver = resolve_with_system_dns,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._target_policy = target_policy
        self._semaphore = asyncio.Semaphore(max_concurrent_checks)
        self._max_response_bytes = max_response_bytes
        self._max_redirects = max_redirects
        self._resolver = resolver
        self._transport = transport

    async def check(
        self, target_url: str, expected_status_code: int, timeout_ms: int, degraded_threshold_ms: int
    ) -> CheckOutcome:
        async with self._semaphore:
            started_at = time.perf_counter()
            try:
                async with asyncio.timeout(timeout_ms / 1000):
                    status_code = await self._fetch_final_status(target_url, timeout_ms / 1000)
            except TimeoutError:
                return _down("TIMEOUT", f"No response within {timeout_ms} ms.")
            except _CheckFailedError as error:
                return _down(error.error_code, error.message)
            except TargetNotAllowedError as error:
                return _down("TARGET_BLOCKED", str(error))
            except httpx.TimeoutException:
                return _down("TIMEOUT", f"No response within {timeout_ms} ms.")
            except httpx.ConnectError:
                return _down("CONNECTION_FAILED", "Could not connect to the target.")
            except (httpx.HTTPError, OSError):
                logger.warning("health check request failed", exc_info=True)
                return _down("REQUEST_FAILED", "The request to the target failed.")

            latency_ms = round((time.perf_counter() - started_at) * 1000)
            if status_code != expected_status_code:
                return CheckOutcome(
                    "down",
                    status_code,
                    latency_ms,
                    "UNEXPECTED_STATUS",
                    f"Expected HTTP {expected_status_code}, received {status_code}.",
                )
            if latency_ms > degraded_threshold_ms:
                return CheckOutcome(
                    "degraded",
                    status_code,
                    latency_ms,
                    "SLOW_RESPONSE",
                    f"Response took {latency_ms} ms (threshold {degraded_threshold_ms} ms).",
                )
            return CheckOutcome("up", status_code, latency_ms, None, None)

    async def _fetch_final_status(self, target_url: str, timeout_seconds: float) -> int:
        current_url = target_url
        for redirect_count in range(self._max_redirects + 1):
            target = self._validate(current_url, is_redirect=redirect_count > 0)
            address = await self._resolve_safe_address(target)
            status_code, location = await self._send_pinned_request(target, address, timeout_seconds)

            if 300 <= status_code < 400 and location:
                if redirect_count >= self._max_redirects:
                    raise _CheckFailedError(
                        "TOO_MANY_REDIRECTS", f"More than {self._max_redirects} redirects."
                    )
                current_url = urljoin(current_url, location)
                continue
            return status_code
        raise _CheckFailedError("TOO_MANY_REDIRECTS", f"More than {self._max_redirects} redirects.")

    def _validate(self, url: str, is_redirect: bool) -> ValidatedTarget:
        try:
            return self._target_policy.validate_url(url)
        except TargetNotAllowedError as error:
            if is_redirect:
                raise _CheckFailedError(
                    "REDIRECT_BLOCKED", "The target redirected to a URL that is not approved."
                ) from error
            raise

    async def _resolve_safe_address(self, target: ValidatedTarget) -> IPAddress:
        try:
            addresses = await self._resolver(target.origin.host, target.origin.port)
        except OSError as error:
            raise _CheckFailedError(
                "DNS_RESOLUTION_FAILED", "The target host name could not be resolved."
            ) from error
        if not addresses:
            raise _CheckFailedError("DNS_RESOLUTION_FAILED", "The target host name could not be resolved.")
        # Every address must be safe: an attacker could mix a public and a private answer.
        for address in addresses:
            self._target_policy.check_ip_address(address)
        return addresses[0]

    async def _send_pinned_request(
        self, target: ValidatedTarget, address: IPAddress, timeout_seconds: float
    ) -> tuple[int, str | None]:
        origin = target.origin
        host_in_url = f"[{address}]" if address.version == 6 else str(address)
        request_url = f"{origin.scheme}://{host_in_url}:{origin.port}{target.path_and_query}"
        is_default_port = (origin.scheme, origin.port) in {("http", 80), ("https", 443)}
        headers = {
            "Host": origin.host if is_default_port else f"{origin.host}:{origin.port}",
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "Accept-Encoding": "identity",
        }
        # TLS: present and verify the certificate for the original host name.
        extensions = {"sni_hostname": origin.host} if origin.scheme == "https" else {}

        async with httpx.AsyncClient(
            transport=self._transport,
            follow_redirects=False,
            timeout=httpx.Timeout(timeout_seconds),
            trust_env=False,
        ) as client:
            request = client.build_request("GET", request_url, headers=headers, extensions=extensions)
            response = await client.send(request, stream=True)
            try:
                await self._read_limited_body(response)
            finally:
                await response.aclose()
            return response.status_code, response.headers.get("location")

    async def _read_limited_body(self, response: httpx.Response) -> None:
        declared_length = response.headers.get("content-length", "")
        if declared_length.isdigit() and int(declared_length) > self._max_response_bytes:
            raise _CheckFailedError(
                "RESPONSE_TOO_LARGE", f"Response is larger than {self._max_response_bytes} bytes."
            )
        received_bytes = 0
        async for chunk in response.aiter_raw():
            received_bytes += len(chunk)
            if received_bytes > self._max_response_bytes:
                raise _CheckFailedError(
                    "RESPONSE_TOO_LARGE", f"Response is larger than {self._max_response_bytes} bytes."
                )


def _down(error_code: str, message: str) -> CheckOutcome:
    return CheckOutcome("down", None, None, error_code, message)
