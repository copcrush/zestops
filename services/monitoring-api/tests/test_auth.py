"""Unit tests for internal JWT verification."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.rsa import generate_private_key
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app.security.auth import InvalidTokenError, TokenVerifier
from tests.conftest import TEST_AUDIENCE, TEST_ISSUER


@pytest.fixture(scope="module")
def private_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


@pytest.fixture(scope="module")
def verifier(private_key: Ed25519PrivateKey) -> TokenVerifier:
    return TokenVerifier(private_key.public_key(), TEST_ISSUER, TEST_AUDIENCE)


def make_claims(**overrides: object) -> dict[str, object]:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": TEST_ISSUER,
        "aud": TEST_AUDIENCE,
        "sub": str(uuid.uuid4()),
        "role": "viewer",
        "iat": now,
        "exp": now + 120,
    }
    claims.update(overrides)
    return claims


def test_valid_token_returns_principal(verifier: TokenVerifier, private_key: Ed25519PrivateKey) -> None:
    claims = make_claims(role="admin")
    principal = verifier.verify(jwt.encode(claims, private_key, algorithm="EdDSA"))
    assert str(principal.user_id) == claims["sub"]
    assert principal.is_admin


@pytest.mark.parametrize(
    ("description", "claim_overrides"),
    [
        ("wrong issuer", {"iss": "attacker"}),
        ("token for the payment API", {"aud": "zestops-payment-api"}),
        ("expired", {"iat": int(time.time()) - 300, "exp": int(time.time()) - 200}),
        ("lifetime above five minutes", {"exp": int(time.time()) + 3600}),
        ("unknown role", {"role": "superuser"}),
        ("missing role", {"role": None}),
        ("subject not a UUID", {"sub": "admin"}),
        ("not yet valid", {"nbf": int(time.time()) + 600}),
    ],
)
def test_invalid_claims_are_rejected(
    verifier: TokenVerifier,
    private_key: Ed25519PrivateKey,
    description: str,
    claim_overrides: dict[str, object],
) -> None:
    with pytest.raises(InvalidTokenError):
        verifier.verify(jwt.encode(make_claims(**claim_overrides), private_key, algorithm="EdDSA"))


def test_missing_expiry_is_rejected(verifier: TokenVerifier, private_key: Ed25519PrivateKey) -> None:
    claims = make_claims()
    del claims["exp"]
    with pytest.raises(InvalidTokenError):
        verifier.verify(jwt.encode(claims, private_key, algorithm="EdDSA"))


def test_token_signed_by_another_key_is_rejected(verifier: TokenVerifier) -> None:
    with pytest.raises(InvalidTokenError):
        verifier.verify(jwt.encode(make_claims(), Ed25519PrivateKey.generate(), algorithm="EdDSA"))


def test_algorithm_none_is_rejected(verifier: TokenVerifier) -> None:
    unsigned_token = jwt.encode(make_claims(role="admin"), key=None, algorithm="none")  # type: ignore[arg-type]
    with pytest.raises(InvalidTokenError):
        verifier.verify(unsigned_token)


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def test_hmac_with_public_key_is_rejected(verifier: TokenVerifier, private_key: Ed25519PrivateKey) -> None:
    """Classic "algorithm confusion" attack: sign HS256 using the PUBLIC key as the secret."""
    public_pem = private_key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    header = _base64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _base64url(json.dumps(make_claims(role="admin")).encode())
    signature = hmac.new(public_pem, f"{header}.{payload}".encode(), hashlib.sha256).digest()
    forged_token = f"{header}.{payload}.{_base64url(signature)}"
    with pytest.raises(InvalidTokenError):
        verifier.verify(forged_token)


def test_rs256_token_is_rejected(verifier: TokenVerifier) -> None:
    rsa_key = generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(InvalidTokenError):
        verifier.verify(jwt.encode(make_claims(role="admin"), rsa_key, algorithm="RS256"))


@pytest.mark.parametrize("garbage", ["", "not-a-jwt", "a.b.c", "eyJhbGciOiJFZERTQSJ9.e30."])
def test_malformed_tokens_are_rejected(verifier: TokenVerifier, garbage: str) -> None:
    with pytest.raises(InvalidTokenError):
        verifier.verify(garbage)
