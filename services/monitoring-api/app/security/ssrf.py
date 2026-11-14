"""SSRF (Server-Side Request Forgery) protection for health checks.

A monitoring service makes HTTP requests on behalf of users, so an attacker
might try to make it call internal systems (databases, admin panels, the cloud
metadata endpoint 169.254.169.254 that hands out credentials, ...).

Defense in depth:
1. Registration: a target URL must match an origin (scheme + host + port) in
   the server-side allowlist MONITORING_ALLOWED_TARGETS. Users cannot add origins.
2. Check time: the host is resolved, and EVERY resolved IP address must pass
   the IP policy (metadata/link-local/multicast/reserved always blocked;
   private/loopback blocked unless explicitly allowed for local development).
3. The HTTP request is sent to the validated IP itself ("DNS pinning"), so a
   DNS answer cannot change between the check and the request (DNS rebinding).
4. Redirects are re-validated hop by hop and limited (see health_checker.py).
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from urllib.parse import SplitResult, urlsplit

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

MAXIMUM_URL_LENGTH = 2048
DEFAULT_PORTS = {"http": 80, "https": 443}

# Cloud metadata endpoints are never allowed, even when private networks are.
ALWAYS_BLOCKED_ADDRESSES: frozenset[IPAddress] = frozenset(
    {
        ipaddress.ip_address("169.254.169.254"),  # AWS, GCP, Azure, DigitalOcean, ...
        ipaddress.ip_address("169.254.170.2"),  # AWS ECS task metadata
        ipaddress.ip_address("100.100.100.200"),  # Alibaba Cloud
        ipaddress.ip_address("fd00:ec2::254"),  # AWS IPv6 metadata
    }
)
ALWAYS_BLOCKED_NETWORKS = (
    ipaddress.ip_network("0.0.0.0/8"),  # "this network": 0.x.x.x can reach the local host on Linux
    ipaddress.ip_network("255.255.255.255/32"),  # broadcast
)
ALWAYS_BLOCKED_HOSTNAMES = frozenset({"metadata.google.internal", "metadata", "instance-data"})
SHARED_ADDRESS_SPACE = ipaddress.ip_network("100.64.0.0/10")  # carrier-grade NAT


class TargetNotAllowedError(ValueError):
    """The URL or the address it resolves to is not allowed. Message is safe to show."""


@dataclass(frozen=True)
class Origin:
    scheme: str
    host: str
    port: int

    def __str__(self) -> str:
        return f"{self.scheme}://{self.host}:{self.port}"


@dataclass(frozen=True)
class ValidatedTarget:
    url: str
    origin: Origin
    path_and_query: str


def _parse_origin(parsed_url: SplitResult) -> Origin:
    scheme = parsed_url.scheme.lower()
    if scheme not in DEFAULT_PORTS:
        raise TargetNotAllowedError("Only http and https URLs are allowed.")
    if parsed_url.username is not None or parsed_url.password is not None:
        raise TargetNotAllowedError("URLs must not contain credentials.")
    host = (parsed_url.hostname or "").lower()
    if not host or not host.isascii():
        raise TargetNotAllowedError("URL must contain an ASCII host name.")
    try:
        port = parsed_url.port or DEFAULT_PORTS[scheme]
    except ValueError as error:
        raise TargetNotAllowedError("URL port is invalid.") from error
    return Origin(scheme=scheme, host=host, port=port)


class TargetPolicy:
    """Decides which URLs and IP addresses the monitor may contact."""

    def __init__(self, allowed_origins: list[str], allow_private_network: bool) -> None:
        self.allow_private_network = allow_private_network
        self.allowed_origins: frozenset[Origin] = frozenset(
            self._parse_allowlist_entry(entry) for entry in allowed_origins
        )

    @staticmethod
    def _parse_allowlist_entry(entry: str) -> Origin:
        parsed = urlsplit(entry.strip())
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError(f"Allowlist entry must be an origin without a path: {entry!r}")
        origin = _parse_origin(parsed)
        if origin.host in ALWAYS_BLOCKED_HOSTNAMES:
            raise ValueError(f"Allowlist entry targets a cloud metadata host: {entry!r}")
        return origin

    def validate_url(self, url: str) -> ValidatedTarget:
        """Check URL syntax and that its origin is in the allowlist."""
        if len(url) > MAXIMUM_URL_LENGTH:
            raise TargetNotAllowedError("URL is too long.")
        if any(character.isspace() or ord(character) < 32 for character in url):
            raise TargetNotAllowedError("URL contains whitespace or control characters.")
        parsed = urlsplit(url)
        if parsed.fragment:
            raise TargetNotAllowedError("URL must not contain a fragment (#...).")
        origin = _parse_origin(parsed)
        if origin.host in ALWAYS_BLOCKED_HOSTNAMES:
            raise TargetNotAllowedError("This host is never allowed.")
        if origin not in self.allowed_origins:
            raise TargetNotAllowedError("This URL is not in the approved monitoring targets.")

        path_and_query = parsed.path or "/"
        if parsed.query:
            path_and_query += "?" + parsed.query
        return ValidatedTarget(url=url, origin=origin, path_and_query=path_and_query)

    def check_ip_address(self, address: IPAddress) -> None:
        """Raise TargetNotAllowedError if the resolved address must not be contacted."""
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
            address = address.ipv4_mapped

        if address in ALWAYS_BLOCKED_ADDRESSES:
            raise TargetNotAllowedError("Target resolves to a blocked cloud metadata address.")
        is_in_blocked_network = isinstance(address, ipaddress.IPv4Address) and any(
            address in network for network in ALWAYS_BLOCKED_NETWORKS
        )
        # Python marks ::1 as "reserved" too, so loopback is excluded from that test.
        is_reserved = address.is_reserved and not address.is_loopback
        if (
            is_in_blocked_network
            or address.is_link_local
            or address.is_multicast
            or address.is_unspecified
            or is_reserved
        ):
            raise TargetNotAllowedError("Target resolves to a blocked network address.")

        is_private_network = (
            address.is_loopback
            or address.is_private
            or (isinstance(address, ipaddress.IPv4Address) and address in SHARED_ADDRESS_SPACE)
        )
        if is_private_network:
            if not self.allow_private_network:
                raise TargetNotAllowedError("Target resolves to a private network address.")
            return
        if not address.is_global:
            raise TargetNotAllowedError("Target resolves to a non-public network address.")
