package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// maximumRequestBodyBytes is far above any legitimate payment request.
const maximumRequestBodyBytes = 64 * 1024

// SecurityHeaders sets defensive headers. This API only returns JSON and is
// never rendered in a browser frame, so everything else is denied.
func SecurityHeaders(isProduction bool) gin.HandlerFunc {
	return func(context *gin.Context) {
		headers := context.Writer.Header()
		headers.Set("X-Content-Type-Options", "nosniff")
		headers.Set("X-Frame-Options", "DENY")
		headers.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		headers.Set("Referrer-Policy", "no-referrer")
		headers.Set("Cache-Control", "no-store")
		headers.Set("Cross-Origin-Resource-Policy", "same-origin")
		if isProduction {
			headers.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		context.Next()
	}
}

// LimitRequestBody rejects oversized bodies before they are read into memory.
func LimitRequestBody() gin.HandlerFunc {
	return func(context *gin.Context) {
		if context.Request.ContentLength > maximumRequestBodyBytes {
			AbortWithError(context, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE",
				"Request body is too large.", nil)
			return
		}
		context.Request.Body = http.MaxBytesReader(context.Writer, context.Request.Body, maximumRequestBodyBytes)
		context.Next()
	}
}
