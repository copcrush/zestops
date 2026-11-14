# syntax=docker/dockerfile:1
# ---------- build stage: compile a static Go binary ----------
FROM golang:1.27-alpine AS build
WORKDIR /src

# Download dependencies first so Docker can cache this layer.
# The optional "extra_ca_certificates" build secret is only needed behind a
# TLS-inspecting proxy (corporate networks, some cloud sandboxes). See
# docs/runbooks/DEBUGGING.md. Without it the system CA bundle is used.
COPY go.mod go.sum ./
RUN --mount=type=secret,id=extra_ca_certificates \
    if [ -s /run/secrets/extra_ca_certificates ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca_certificates > /tmp/ca-bundle.crt; \
      export SSL_CERT_FILE=/tmp/ca-bundle.crt; \
    fi; \
    go mod download

COPY . .
# CGO disabled -> fully static binary that runs on a minimal image.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/payment-api ./cmd/payment-api

# ---------- runtime stage: no shell, no package manager, non-root ----------
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/payment-api /payment-api
USER nonroot:nonroot
ENV APP_ENV=production PORT=8080
EXPOSE 8080
# Distroless has no curl/wget, so the binary checks its own health.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/payment-api", "healthcheck"]
ENTRYPOINT ["/payment-api"]
