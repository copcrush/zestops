package middleware

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// AccessLog writes one structured log line per request. It never logs request
// bodies, Authorization headers or cookies.
func AccessLog(logger *slog.Logger) gin.HandlerFunc {
	return func(context *gin.Context) {
		startedAt := time.Now()
		context.Next()

		route := context.FullPath()
		if route == "" {
			route = "unmatched"
		}
		attributes := []any{
			"request_id", GetRequestID(context),
			"correlation_id", GetCorrelationID(context),
			"method", context.Request.Method,
			"route", route,
			"status", context.Writer.Status(),
			"duration_ms", time.Since(startedAt).Milliseconds(),
			"client_ip", context.ClientIP(),
		}
		if principal, ok := GetPrincipal(context); ok {
			attributes = append(attributes, "user_id", principal.UserID, "role", principal.Role)
		}

		status := context.Writer.Status()
		switch {
		case status >= http.StatusInternalServerError:
			logger.Error("request completed", attributes...)
		case status >= http.StatusBadRequest:
			logger.Warn("request completed", attributes...)
		default:
			logger.Info("request completed", attributes...)
		}
	}
}

// Recovery turns a panic into a safe 500 response and logs the panic value
// (never the request body).
func Recovery(logger *slog.Logger) gin.HandlerFunc {
	return func(context *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error("panic recovered", "request_id", GetRequestID(context), "panic", recovered)
				AbortWithError(context, http.StatusInternalServerError, "INTERNAL_ERROR",
					"An unexpected error occurred.", nil)
			}
		}()
		context.Next()
	}
}
