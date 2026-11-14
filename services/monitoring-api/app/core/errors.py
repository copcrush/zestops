"""Consistent error responses.

Every error uses the shared ZestOps envelope:
    {"error": {"code": "SNAKE_CASE", "message": "...", "request_id": "...", "details": ...}}
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_context

logger = logging.getLogger(__name__)


class AppError(Exception):
    """An expected error with a safe, client-facing message."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers


class NotFoundError(AppError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(404, code, message)


class ConflictError(AppError):
    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(409, code, message, details)


class ValidationFailedError(AppError):
    def __init__(self, field: str, message: str) -> None:
        super().__init__(
            400,
            "VALIDATION_ERROR",
            "The request contains invalid fields.",
            [{"field": field, "message": message}],
        )


def error_response(
    status_code: int, code: str, message: str, details: Any = None, headers: dict[str, str] | None = None
) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message, "request_id": request_id_context.get()}
    if details is not None:
        body["details"] = details
    return JSONResponse(status_code=status_code, content={"error": body}, headers=headers)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, error: AppError) -> JSONResponse:
        return error_response(error.status_code, error.code, error.message, error.details, error.headers)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        field_errors = [
            {"field": ".".join(str(part) for part in item["loc"] if part != "body"), "message": item["msg"]}
            for item in error.errors()
        ]
        return error_response(400, "VALIDATION_ERROR", "The request contains invalid fields.", field_errors)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, error: StarletteHTTPException) -> JSONResponse:
        codes = {
            404: "NOT_FOUND",
            405: "METHOD_NOT_ALLOWED",
            413: "PAYLOAD_TOO_LARGE",
            415: "UNSUPPORTED_MEDIA_TYPE",
        }
        code = codes.get(error.status_code, "HTTP_ERROR")
        message = {404: "Route not found.", 405: "Method not allowed."}.get(
            error.status_code, str(error.detail)
        )
        return error_response(error.status_code, code, message)

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
        # Log the details for operators; return nothing internal to the caller.
        logger.exception("unexpected error", extra={"path": request.url.path})
        return error_response(500, "INTERNAL_ERROR", "An unexpected error occurred.")
