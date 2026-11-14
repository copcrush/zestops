package handler

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/copcrush/zestops/services/payment-api/internal/auth"
	"github.com/copcrush/zestops/services/payment-api/internal/middleware"
)

// RouterDependencies are the objects the router needs.
type RouterDependencies struct {
	Logger         *slog.Logger
	TokenVerifier  *auth.TokenVerifier
	PaymentHandler *PaymentHandler
	HealthHandler  *HealthHandler
	RateLimiter    *middleware.RateLimiter
	IsProduction   bool
	TrustedProxies []string
}

// NewRouter builds the Gin engine with every route and middleware.
//
// Request lifecycle:
//
//	Recovery -> RequestContext -> AccessLog -> SecurityHeaders -> LimitRequestBody
//	  -> (for /v1) Authenticate -> RateLimiter -> RequireRole -> handler
func NewRouter(dependencies RouterDependencies) (*gin.Engine, error) {
	router := gin.New()
	// Do not trust X-Forwarded-For unless proxies are explicitly configured.
	if err := router.SetTrustedProxies(dependencies.TrustedProxies); err != nil {
		return nil, err
	}
	router.HandleMethodNotAllowed = true

	router.Use(
		middleware.Recovery(dependencies.Logger),
		middleware.RequestContext(),
		middleware.AccessLog(dependencies.Logger),
		middleware.SecurityHeaders(dependencies.IsProduction),
		middleware.LimitRequestBody(),
	)

	router.GET("/health/live", dependencies.HealthHandler.Live)
	router.GET("/health/ready", dependencies.HealthHandler.Ready)

	anyRole := middleware.RequireRole(dependencies.Logger, auth.RoleAdmin, auth.RoleViewer)
	adminOnly := middleware.RequireRole(dependencies.Logger, auth.RoleAdmin)

	version1 := router.Group("/v1",
		middleware.Authenticate(dependencies.TokenVerifier, dependencies.Logger),
		dependencies.RateLimiter.Middleware(),
	)
	paymentHandler := dependencies.PaymentHandler
	version1.GET("/currencies", anyRole, paymentHandler.ListCurrencies)
	version1.GET("/payments", anyRole, paymentHandler.ListPayments)
	version1.GET("/payments/summary", anyRole, paymentHandler.GetSummary)
	version1.POST("/payments", adminOnly, paymentHandler.CreatePayment)
	version1.GET("/payments/:paymentId", anyRole, paymentHandler.GetPayment)
	version1.GET("/payments/:paymentId/status", anyRole, paymentHandler.GetPaymentStatus)
	version1.POST("/payments/:paymentId/simulate", adminOnly, paymentHandler.SimulatePayment)
	version1.POST("/payments/:paymentId/cancel", adminOnly, paymentHandler.CancelPayment)

	router.NoRoute(func(context *gin.Context) {
		middleware.AbortWithError(context, http.StatusNotFound, "NOT_FOUND", "Route not found.", nil)
	})
	router.NoMethod(func(context *gin.Context) {
		middleware.AbortWithError(context, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed.", nil)
	})
	return router, nil
}
