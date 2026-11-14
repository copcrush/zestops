"""Unit tests for the SSRF target policy (no network, no database)."""

from __future__ import annotations

import ipaddress

import pytest

from app.security.ssrf import TargetNotAllowedError, TargetPolicy

ALLOWLIST = ["http://payment-api:8080", "https://status.example.com"]


@pytest.fixture
def strict_policy() -> TargetPolicy:
    return TargetPolicy(ALLOWLIST, allow_private_network=False)


@pytest.fixture
def local_policy() -> TargetPolicy:
    return TargetPolicy(ALLOWLIST, allow_private_network=True)


@pytest.mark.parametrize(
    "url",
    [
        "http://payment-api:8080/health/ready",
        "http://PAYMENT-API:8080/health?verbose=1",
        "https://status.example.com/",
        "https://status.example.com:443/api/health",
    ],
)
def test_allowlisted_urls_are_accepted(strict_policy: TargetPolicy, url: str) -> None:
    assert strict_policy.validate_url(url).url == url


@pytest.mark.parametrize(
    ("url", "reason"),
    [
        ("http://payment-api:9999/health", "different port"),
        ("https://payment-api:8080/health", "different scheme"),
        ("http://evil.example.com/", "host not in allowlist"),
        ("http://status.example.com/", "allowlisted host but http instead of https"),
        ("http://169.254.169.254/latest/meta-data/", "cloud metadata IP"),
        ("http://metadata.google.internal/computeMetadata/v1/", "metadata host name"),
        ("http://2130706433/", "decimal-encoded 127.0.0.1"),
        ("http://127.0.0.1:8080/", "loopback IP literal"),
        ("http://user:pass@payment-api:8080/", "credentials in URL"),
        ("http://payment-api:8080@evil.example.com/", "userinfo trick"),
        ("http://payment-api:8080/health#fragment", "fragment"),
        ("http://payment-api:8080/he alth", "whitespace"),
        ("http://payment-api:8080/\r\nX-Injected: 1", "header injection attempt"),
        ("file:///etc/passwd", "file scheme"),
        ("gopher://payment-api:8080/", "gopher scheme"),
        ("ftp://payment-api:8080/", "ftp scheme"),
        ("http://payment-api:8080/" + "a" * 2100, "too long"),
        ("http://payment-api:notaport/", "invalid port"),
        ("http://pаyment-api:8080/", "non-ASCII homograph host"),  # noqa: RUF001  (deliberate homograph)
    ],
)
def test_disallowed_urls_are_rejected(strict_policy: TargetPolicy, url: str, reason: str) -> None:
    with pytest.raises(TargetNotAllowedError):
        strict_policy.validate_url(url)


@pytest.mark.parametrize(
    "address",
    [
        "169.254.169.254",  # AWS/GCP/Azure metadata
        "169.254.170.2",  # AWS ECS metadata
        "100.100.100.200",  # Alibaba metadata
        "fd00:ec2::254",  # AWS IPv6 metadata
        "::ffff:169.254.169.254",  # metadata hidden in an IPv4-mapped IPv6 address
        "169.254.1.1",  # link-local
        "fe80::1",  # IPv6 link-local
        "0.0.0.0",  # noqa: S104  (unspecified address under test)
        "0.1.2.3",  # 0.0.0.0/8 can reach the local host
        "255.255.255.255",  # broadcast
        "::",
        "224.0.0.1",  # multicast
        "240.0.0.1",  # reserved
    ],
)
def test_dangerous_addresses_are_always_blocked(local_policy: TargetPolicy, address: str) -> None:
    with pytest.raises(TargetNotAllowedError):
        local_policy.check_ip_address(ipaddress.ip_address(address))


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.18.0.3",
        "192.168.1.10",
        "::1",
        "fc00::1",
        "100.64.0.1",
        "::ffff:127.0.0.1",
    ],
)
def test_private_addresses_blocked_unless_explicitly_allowed(
    strict_policy: TargetPolicy, local_policy: TargetPolicy, address: str
) -> None:
    with pytest.raises(TargetNotAllowedError):
        strict_policy.check_ip_address(ipaddress.ip_address(address))
    local_policy.check_ip_address(ipaddress.ip_address(address))  # must not raise


@pytest.mark.parametrize("address", ["93.184.215.14", "2606:4700::6810:84e5"])
def test_public_addresses_are_allowed(strict_policy: TargetPolicy, address: str) -> None:
    strict_policy.check_ip_address(ipaddress.ip_address(address))


@pytest.mark.parametrize(
    "entry",
    [
        "http://payment-api:8080/health",
        "http://metadata.google.internal",
        "ftp://files.example.com",
        "http://user@host.example.com",
    ],
)
def test_invalid_allowlist_entries_fail_at_startup(entry: str) -> None:
    with pytest.raises(ValueError, match=r".+"):
        TargetPolicy([entry], allow_private_network=False)
