package middleware

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/copcrush/zestops/services/payment-api/internal/auth"
)

// Authenticate requires a valid internal JWT in "Authorization: Bearer <token>".
// On success the Principal (user ID + role) is stored in the request context.
func Authenticate(verifier *auth.TokenVerifier, logger *slog.Logger) gin.HandlerFunc {
	return func(context *gin.Context) {
		authorizationHeader := context.GetHeader("Authorization")
		rawToken, hasBearerPrefix := strings.CutPrefix(authorizationHeader, "Bearer ")
		if !hasBearerPrefix || strings.TrimSpace(rawToken) == "" {
			AbortWithError(context, http.StatusUnauthorized, "UNAUTHENTICATED",
				"Authentication is required.", nil)
			return
		}

		principal, err := verifier.Verify(strings.TrimSpace(rawToken))
		if err != nil {
			// Security event: log the reason, but tell the caller nothing specific.
			logger.Warn("internal token rejected",
				"request_id", GetRequestID(context), "reason", err.Error(), "client_ip", context.ClientIP())
			AbortWithError(context, http.StatusUnauthorized, "UNAUTHENTICATED",
				"Authentication is required.", nil)
			return
		}

		context.Set(principalContextKey, principal)
		context.Next()
	}
}

// RequireRole allows the request only if the principal has one of the roles.
func RequireRole(logger *slog.Logger, allowedRoles ...string) gin.HandlerFunc {
	return func(context *gin.Context) {
		principal, ok := GetPrincipal(context)
		if !ok {
			AbortWithError(context, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.", nil)
			return
		}
		for _, allowedRole := range allowedRoles {
			if principal.Role == allowedRole {
				context.Next()
				return
			}
		}
		logger.Warn("authorization denied",
			"request_id", GetRequestID(context), "user_id", principal.UserID, "role", principal.Role,
			"method", context.Request.Method, "route", context.FullPath())
		AbortWithError(context, http.StatusForbidden, "FORBIDDEN",
			"You do not have permission to perform this action.", nil)
	}
}
