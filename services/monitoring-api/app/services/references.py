import secrets

# Crockford base32 alphabet: no I, L, O, U (easy to read aloud and type).
_REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def generate_reference(prefix: str, length: int = 10) -> str:
    """Random human-friendly reference such as INC-7K2M9Q4XZD."""
    return prefix + "-" + "".join(secrets.choice(_REFERENCE_ALPHABET) for _ in range(length))
