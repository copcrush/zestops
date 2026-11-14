// Package middleware contains Gin middleware that runs before every handler:
// request IDs, structured access logs, panic recovery, security headers,
// authentication, authorization (RBAC) and rate limiting.
package middleware

import (
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/copcrush/zestops/services/payment-api/internal/auth"
)

// Header names used for request tracing.
const (
	RequestIDHeader     = "X-Request-ID"
	CorrelationIDHeader = "X-Correlation-ID"
)

const (
	requestIDContextKey     = "request_id"
	correlationIDContextKey = "correlation_id"
	principalContextKey     = "principal"
)

// safeTraceIDPattern stops attackers from injecting newlines or huge values
// into our logs through tracing headers.
var safeTraceIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,64}$`)

// RequestContext assigns a unique request ID to every request and keeps the
// caller's correlation ID (from the web BFF) so one user action can be traced
// across services. Both are returned as response headers.
func RequestContext() gin.HandlerFunc {
	return func(context *gin.Context) {
		requestID := uuid.NewString()
		correlationID := context.GetHeader(CorrelationIDHeader)
		if !safeTraceIDPattern.MatchString(correlationID) {
			correlationID = requestID
		}

		context.Set(requestIDContextKey, requestID)
		context.Set(correlationIDContextKey, correlationID)
		context.Header(RequestIDHeader, requestID)
		context.Header(CorrelationIDHeader, correlationID)
		context.Next()
	}
}

// GetRequestID returns the current request ID.
func GetRequestID(context *gin.Context) string {
	return context.GetString(requestIDContextKey)
}

// GetCorrelationID returns the current correlation ID.
func GetCorrelationID(context *gin.Context) string {
	return context.GetString(correlationIDContextKey)
}

// GetPrincipal returns the authenticated caller. ok is false on public routes.
func GetPrincipal(context *gin.Context) (principal auth.Principal, ok bool) {
	value, exists := context.Get(principalContextKey)
	if !exists {
		return auth.Principal{}, false
	}
	principal, ok = value.(auth.Principal)
	return principal, ok
}
