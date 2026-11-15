# API Error Format

Every ZestOps API (web BFF `/api/*`, Payment API, Monitoring API) returns errors in
the same envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "request_id": "8f0c2d8e-0b5e-4a8e-9a37-1f1d6e5f3f10",
    "details": [{ "field": "amount_minor", "message": "must be between 1 and 100000000000" }]
  }
}
```

- `code` is stable and machine-readable (`SNAKE_CASE`). Clients switch on it.
- `message` is safe to show to users. It never contains SQL, stack traces or hostnames.
- `request_id` matches the `X-Request-ID` response header and the server logs.
- `details` is optional: a list of field errors for validation, or an object with context.

## Codes

| HTTP | Code | Where | Meaning |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | all | One or more fields are invalid (`details` lists them) |
| 400 | `INVALID_JSON` | Payment API | Malformed JSON, unknown fields, wrong types, trailing data |
| 401 | `UNAUTHENTICATED` | all | Missing/invalid/expired session or internal token |
| 401 | `INVALID_CREDENTIALS` | BFF login | Wrong e-mail or password (deliberately generic) |
| 403 | `FORBIDDEN` | all | Authenticated, but the role lacks permission |
| 403 | `CSRF_TOKEN_INVALID` | BFF | Missing or wrong `X-CSRF-Token` |
| 403 | `CROSS_ORIGIN_REQUEST` | BFF | `Origin` is not this app |
| 403 | `DEMO_ACCOUNT_READ_ONLY` | BFF | The shared guest account tried to change its profile, password or sessions |
| 404 | `NOT_FOUND` | all | Unknown route |
| 404 | `PAYMENT_NOT_FOUND` / `SERVICE_NOT_FOUND` / `INCIDENT_NOT_FOUND` | backends | Resource does not exist |
| 405 | `METHOD_NOT_ALLOWED` | backends | Wrong HTTP method |
| 409 | `INVALID_STATE_TRANSITION` | backends | e.g. simulating an already settled payment; `details` has `current_status` and `requested_status` |
| 409 | `SERVICE_NAME_TAKEN` | Monitoring API | Duplicate service name |
| 409 | `SERVICE_DISABLED` | Monitoring API | Checking a disabled service |
| 409 | `INCIDENT_RESOLVED` | Monitoring API | Adding a note to a resolved incident |
| 411 | `LENGTH_REQUIRED` | Monitoring API | Chunked body without `Content-Length` |
| 413 | `PAYLOAD_TOO_LARGE` | backends | Body over 64 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Payment API | `Content-Type` is not JSON |
| 422 | `IDEMPOTENCY_KEY_REUSED` | Payment API | Same `Idempotency-Key`, different request body |
| 429 | `RATE_LIMITED` | all | Too many requests; see `Retry-After` |
| 500 | `INTERNAL_ERROR` | all | Unexpected server error (details only in logs) |
| 502 | `BAD_GATEWAY` | BFF | A backend returned a non-JSON response |
| 503 | `BACKEND_UNAVAILABLE` | BFF | A backend could not be reached (down, cold start, timeout) |

## Health check results (not HTTP errors)

Failed monitoring checks are stored as data with `error_code`: `UNEXPECTED_STATUS`,
`SLOW_RESPONSE` (degraded), `TIMEOUT`, `CONNECTION_FAILED`, `DNS_RESOLUTION_FAILED`,
`TARGET_BLOCKED`, `REDIRECT_BLOCKED`, `TOO_MANY_REDIRECTS`, `RESPONSE_TOO_LARGE`,
`REQUEST_FAILED`.
