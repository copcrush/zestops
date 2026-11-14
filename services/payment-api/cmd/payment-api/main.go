// Command payment-api starts the ZestOps Payment API HTTP server.
//
// Startup order: load config -> connect to PostgreSQL -> build layers
// (repository -> service -> handler -> router) -> serve -> graceful shutdown.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/copcrush/zestops/services/payment-api/internal/auth"
	"github.com/copcrush/zestops/services/payment-api/internal/config"
	"github.com/copcrush/zestops/services/payment-api/internal/handler"
	"github.com/copcrush/zestops/services/payment-api/internal/logging"
	"github.com/copcrush/zestops/services/payment-api/internal/middleware"
	"github.com/copcrush/zestops/services/payment-api/internal/repository"
	"github.com/copcrush/zestops/services/payment-api/internal/service"
)

func main() {
	// "payment-api healthcheck" is used by the Docker HEALTHCHECK, because the
	// distroless runtime image has no curl or wget.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(runHealthcheck())
	}

	if err := run(); err != nil {
		slog.Error("payment-api stopped with an error", "error", err.Error())
		os.Exit(1)
	}
}

func runHealthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	client := http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://127.0.0.1:" + port + "/health/live")
	if err != nil {
		return 1
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func run() error {
	// For local "go run": load .env if it exists. Real environment variables win.
	_ = godotenv.Load()

	appConfig, err := config.LoadFromEnvironment()
	if err != nil {
		return err
	}

	logger := logging.NewLogger(os.Stdout, appConfig.LogLevel)
	slog.SetDefault(logger)
	if appConfig.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	startupContext, cancelStartup := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelStartup()

	poolConfig, err := pgxpool.ParseConfig(appConfig.DatabaseURL)
	if err != nil {
		return errors.New("DATABASE_URL is not a valid PostgreSQL connection string")
	}
	poolConfig.MaxConns = 10
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	databasePool, err := pgxpool.NewWithConfig(startupContext, poolConfig)
	if err != nil {
		return err
	}
	defer databasePool.Close()

	paymentRepository := repository.NewPaymentRepository(databasePool)
	paymentService := service.NewPaymentService(paymentRepository, logger)
	router, err := handler.NewRouter(handler.RouterDependencies{
		Logger:         logger,
		TokenVerifier:  auth.NewTokenVerifier(appConfig.JWTPublicKey, appConfig.JWTIssuer, appConfig.JWTAudience),
		PaymentHandler: handler.NewPaymentHandler(paymentService, logger),
		HealthHandler:  handler.NewHealthHandler(paymentRepository),
		RateLimiter:    middleware.NewRateLimiter(appConfig.RateLimitRequestsPerMinute),
		IsProduction:   appConfig.IsProduction(),
		TrustedProxies: appConfig.TrustedProxies,
	})
	if err != nil {
		return err
	}

	server := &http.Server{
		Addr:              ":" + appConfig.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("payment-api listening", "port", appConfig.Port, "environment", appConfig.Environment)
		serverErrors <- server.ListenAndServe()
	}()

	shutdownSignals := make(chan os.Signal, 1)
	signal.Notify(shutdownSignals, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case receivedSignal := <-shutdownSignals:
		logger.Info("shutdown signal received", "signal", receivedSignal.String())
	}

	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(shutdownContext); err != nil {
		return err
	}
	logger.Info("payment-api stopped gracefully")
	return nil
}
