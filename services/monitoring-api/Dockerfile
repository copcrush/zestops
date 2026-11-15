# syntax=docker/dockerfile:1
# ---------- build stage: install locked dependencies into a virtualenv ----------
FROM python:3.15-slim AS build
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY pyproject.toml uv.lock ./
# The optional "extra_ca_certificates" build secret is only needed behind a
# TLS-inspecting proxy (see docs/runbooks/DEBUGGING.md).
RUN --mount=type=secret,id=extra_ca_certificates \
    if [ -s /run/secrets/extra_ca_certificates ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca_certificates > /tmp/ca-bundle.crt; \
      export SSL_CERT_FILE=/tmp/ca-bundle.crt PIP_CERT=/tmp/ca-bundle.crt; \
    fi; \
    pip install --no-cache-dir uv==0.11.32 \
    && uv sync --frozen --no-dev --no-install-project

# ---------- runtime stage: slim image, non-root user, no build tools ----------
FROM python:3.15-slim AS runtime
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin appuser
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY app ./app

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    PORT=8000

USER appuser
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/health/live', timeout=2)"]
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port \"${PORT}\" --no-server-header"]
