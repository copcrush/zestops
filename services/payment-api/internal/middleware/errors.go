package middleware

import (
	"github.com/gin-gonic/gin"
)

// ErrorBody is the shared error response format of every ZestOps API:
//
//	{"error": {"code": "NOT_FOUND", "message": "...", "request_id": "...", "details": [...]}}
type ErrorBody struct {
	Error ErrorDetails `json:"error"`
}

// ErrorDetails is the content of an error response.
type ErrorDetails struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id"`
	Details   any    `json:"details,omitempty"`
}

// AbortWithError writes an error response and stops the handler chain.
func AbortWithError(context *gin.Context, httpStatus int, code string, message string, details any) {
	context.AbortWithStatusJSON(httpStatus, ErrorBody{Error: ErrorDetails{
		Code:      code,
		Message:   message,
		RequestID: GetRequestID(context),
		Details:   details,
	}})
}
