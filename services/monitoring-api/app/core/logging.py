"""Structured JSON logging.

Every log line is one JSON object containing the request and correlation IDs of
the request being handled (stored in context variables by the middleware).
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)
correlation_id_context: ContextVar[str | None] = ContextVar("correlation_id", default=None)

_STANDARD_RECORD_ATTRIBUTES = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "service": "monitoring-api",
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if (request_id := request_id_context.get()) is not None:
            log_entry["request_id"] = request_id
        if (correlation_id := correlation_id_context.get()) is not None:
            log_entry["correlation_id"] = correlation_id
        # Extra key/value pairs passed with logger.info("...", extra={...}).
        for key, value in record.__dict__.items():
            if key not in _STANDARD_RECORD_ATTRIBUTES and not key.startswith("_"):
                log_entry[key] = value
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry, default=str)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(level)
    # Our access-log middleware replaces uvicorn's plain-text access log.
    logging.getLogger("uvicorn.access").disabled = True
    for noisy_logger in ("httpx", "httpcore"):
        logging.getLogger(noisy_logger).setLevel(logging.WARNING)
