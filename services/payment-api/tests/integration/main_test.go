// Package integration tests the whole Payment API (router + middleware +
// service + repository) against a real PostgreSQL database.
//
// Requirements:
//   - TEST_DATABASE_URL        application role (zestops_payment_app) on the test DB
//   - TEST_OWNER_DATABASE_URL  owner role, used only to clean tables between tests
//
// Locally these come from services/payment-api/.env (created by
// scripts/setup-local-env.mjs) and the database from `docker compose up -d`.
// In CI, REQUIRE_INTEGRATION_TESTS=true turns a missing database into a failure
// instead of a skip.
package integration

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/copcrush/zestops/services/payment-api/internal/auth"
	"github.com/copcrush/zestops/services/payment-api/internal/handler"
	"github.com/copcrush/zestops/services/payment-api/internal/middleware"
	"github.com/copcrush/zestops/services/payment-api/internal/repository"
	"github.com/copcrush/zestops/services/payment-api/internal/service"
)

const (
	testIssuer   = "zestops-web"
	testAudience = "zestops-payment-api"
)

var (
	testRouter      *gin.Engine
	applicationPool *pgxpool.Pool
	ownerPool       *pgxpool.Pool
	signingKey      ed25519.PrivateKey
)

func TestMain(testingMain *testing.M) {
	_ = godotenv.Load("../../.env")

	applicationDatabaseURL := os.Getenv("TEST_DATABASE_URL")
	ownerDatabaseURL := os.Getenv("TEST_OWNER_DATABASE_URL")
	if applicationDatabaseURL == "" || ownerDatabaseURL == "" {
		if os.Getenv("REQUIRE_INTEGRATION_TESTS") == "true" {
			fmt.Println("FAIL: TEST_DATABASE_URL and TEST_OWNER_DATABASE_URL are required")
			os.Exit(1)
		}
		fmt.Println("SKIP: integration tests need TEST_DATABASE_URL and TEST_OWNER_DATABASE_URL (see docs/TESTING.md)")
		os.Exit(0)
	}

	exitCode, err := runWithDatabase(testingMain, applicationDatabaseURL, ownerDatabaseURL)
	if err != nil {
		fmt.Println("FAIL: integration test setup:", err)
		os.Exit(1)
	}
	os.Exit(exitCode)
}

func runWithDatabase(testingMain *testing.M, applicationDatabaseURL string, ownerDatabaseURL string) (int, error) {
	setupContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var err error
	applicationPool, err = pgxpool.New(setupContext, applicationDatabaseURL)
	if err != nil {
		return 1, err
	}
	defer applicationPool.Close()
	ownerPool, err = pgxpool.New(setupContext, ownerDatabaseURL)
	if err != nil {
		return 1, err
	}
	defer ownerPool.Close()
	if err := applicationPool.Ping(setupContext); err != nil {
		return 1, fmt.Errorf("cannot reach test database (is docker compose running and migrated?): %w", err)
	}

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return 1, err
	}
	signingKey = privateKey

	gin.SetMode(gin.TestMode)
	silentLogger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	paymentRepository := repository.NewPaymentRepository(applicationPool)
	testRouter, err = handler.NewRouter(handler.RouterDependencies{
		Logger:         silentLogger,
		TokenVerifier:  auth.NewTokenVerifier(publicKey, testIssuer, testAudience),
		PaymentHandler: handler.NewPaymentHandler(service.NewPaymentService(paymentRepository, silentLogger), silentLogger),
		HealthHandler:  handler.NewHealthHandler(paymentRepository),
		// High limit so functional tests are never throttled; the limiter has its own tests.
		RateLimiter: middleware.NewRateLimiter(10000),
	})
	if err != nil {
		return 1, err
	}

	return testingMain.Run(), nil
}
