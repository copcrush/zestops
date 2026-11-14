"""HTTP middleware: request IDs, access logs, security headers, body size limit."""

from __future__ import annotations

import logging
import re
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.errors import error_response
from app.core.logging import correlation_id_context, request_id_context

access_logger = logging.getLogger("monitoring_api.access")

# Tracing headers come from outside; only accept short, safe values so nobody
# can inject fake log lines.
SAFE_TRACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
MAXIMUM_REQUEST_BODY_BYTES = 64 * 1024


class RequestContextMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: object, is_production: bool) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.is_production = is_production

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = str(uuid.uuid4())
        incoming_correlation_id = request.headers.get("x-correlation-id", "")
        correlation_id = (
            incoming_correlation_id if SAFE_TRACE_ID_PATTERN.match(incoming_correlation_id) else request_id
        )
        request_id_token = request_id_context.set(request_id)
        correlation_id_token = correlation_id_context.set(correlation_id)
        started_at = time.perf_counter()

        try:
            content_length = request.headers.get("content-length")
            has_body_method = request.method in {"POST", "PUT", "PATCH"}
            if content_length is None and has_body_method and "transfer-encoding" in request.headers:
                # Streamed (chunked) bodies cannot be size-checked up front: refuse them.
                response: Response = error_response(
                    411, "LENGTH_REQUIRED", "Content-Length header is required."
                )
            elif content_length is not None and (
                not content_length.isdigit() or int(content_length) > MAXIMUM_REQUEST_BODY_BYTES
            ):
                response = error_response(413, "PAYLOAD_TOO_LARGE", "Request body is too large.")
            else:
                response = await call_next(request)

            self._apply_security_headers(response)
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Correlation-ID"] = correlation_id

            route = request.scope.get("route")
            access_logger.log(
                logging.ERROR
                if response.status_code >= 500
                else logging.WARNING
                if response.status_code >= 400
                else logging.INFO,
                "request completed",
                extra={
                    "method": request.method,
                    "route": getattr(route, "path", "unmatched"),
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 1),
                    "user_id": getattr(request.state, "user_id", None),
                },
            )
            return response
        finally:
            request_id_context.reset(request_id_token)
            correlation_id_context.reset(correlation_id_token)

    def _apply_security_headers(self, response: Response) -> None:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        if self.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
