package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestRateLimiterRejectsAfterBurst(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(RequestContext(), NewRateLimiter(3).Middleware())
	router.GET("/limited", func(context *gin.Context) { context.Status(http.StatusNoContent) })

	statuses := []int{}
	for range 5 {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/limited", nil))
		statuses = append(statuses, recorder.Code)
		if recorder.Code == http.StatusTooManyRequests {
			require.NotEmpty(t, recorder.Header().Get("Retry-After"))
		}
	}

	require.Equal(t, []int{204, 204, 204, 429, 429}, statuses)
}

func TestRequestContextRejectsUnsafeCorrelationID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(RequestContext())
	router.GET("/", func(context *gin.Context) { context.Status(http.StatusNoContent) })

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set(CorrelationIDHeader, "abc\nINJECTED log line")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, recorder.Header().Get(RequestIDHeader), recorder.Header().Get(CorrelationIDHeader),
		"an unsafe correlation ID must be replaced by the request ID")

	request = httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set(CorrelationIDHeader, "web-1234")
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	require.Equal(t, "web-1234", recorder.Header().Get(CorrelationIDHeader))
}
