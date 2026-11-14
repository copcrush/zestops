"""Shared Pydantic types for request validation and responses."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict


def _reject_control_characters(value: str) -> str:
    if any(ord(character) < 32 and character != "\n" for character in value):
        raise ValueError("must not contain control characters")
    return value


def _strip(value: str) -> str:
    return value.strip()


# Free text typed by users: trimmed, no control characters (newlines allowed).
CleanText = Annotated[str, AfterValidator(_strip), AfterValidator(_reject_control_characters)]


class RequestModel(BaseModel):
    """Base for request bodies: unknown fields are rejected, not silently ignored."""

    model_config = ConfigDict(extra="forbid", str_max_length=4096)


class ResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PageCursor(BaseModel):
    created_at: datetime
    id: uuid.UUID

    def encode(self) -> str:
        return base64.urlsafe_b64encode(self.model_dump_json().encode()).decode().rstrip("=")

    @classmethod
    def decode(cls, encoded_cursor: str) -> PageCursor:
        if len(encoded_cursor) > 200:
            raise ValueError("invalid cursor")
        padding = "=" * (-len(encoded_cursor) % 4)
        try:
            decoded = json.loads(base64.urlsafe_b64decode(encoded_cursor + padding))
            return cls.model_validate(decoded)
        except (ValueError, TypeError) as error:
            raise ValueError("invalid cursor") from error
