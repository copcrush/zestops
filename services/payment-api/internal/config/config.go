// Package config loads and validates the Payment API configuration from
// environment variables. Invalid configuration stops the service at startup
// instead of failing later at request time.
package config

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Environment names.
const (
	EnvironmentDevelopment = "development"
	EnvironmentTest        = "test"
	EnvironmentProduction  = "production"
)

// Config holds every setting the service needs.
type Config struct {
	Environment                string
	Port                       string
	LogLevel                   string
	DatabaseURL                string
	JWTIssuer                  string
	JWTAudience                string
	JWTPublicKey               ed25519.PublicKey
	RateLimitRequestsPerMinute int
	TrustedProxies             []string
}

// IsProduction reports whether the service runs in production mode.
func (config Config) IsProduction() bool {
	return config.Environment == EnvironmentProduction
}

// LoadFromEnvironment reads configuration from environment variables.
func LoadFromEnvironment() (Config, error) {
	var problems []string

	environment := readWithDefault("APP_ENV", EnvironmentDevelopment)
	if environment != EnvironmentDevelopment && environment != EnvironmentTest && environment != EnvironmentProduction {
		problems = append(problems, "APP_ENV must be development, test or production")
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		problems = append(problems, "DATABASE_URL is required")
	}

	publicKey, err := ParseEd25519PublicKeyBase64(os.Getenv("INTERNAL_JWT_PUBLIC_KEY_BASE64"))
	if err != nil {
		problems = append(problems, "INTERNAL_JWT_PUBLIC_KEY_BASE64: "+err.Error())
	}

	rateLimit, err := strconv.Atoi(readWithDefault("RATE_LIMIT_REQUESTS_PER_MINUTE", "120"))
	if err != nil || rateLimit < 1 || rateLimit > 10000 {
		problems = append(problems, "RATE_LIMIT_REQUESTS_PER_MINUTE must be an integer between 1 and 10000")
	}

	logLevel := strings.ToLower(readWithDefault("LOG_LEVEL", "info"))
	if logLevel != "debug" && logLevel != "info" && logLevel != "warn" && logLevel != "error" {
		problems = append(problems, "LOG_LEVEL must be debug, info, warn or error")
	}

	if len(problems) > 0 {
		return Config{}, errors.New("invalid configuration: " + strings.Join(problems, "; "))
	}

	return Config{
		Environment:                environment,
		Port:                       readWithDefault("PORT", "8080"),
		LogLevel:                   logLevel,
		DatabaseURL:                databaseURL,
		JWTIssuer:                  readWithDefault("INTERNAL_JWT_ISSUER", "zestops-web"),
		JWTAudience:                readWithDefault("INTERNAL_JWT_AUDIENCE", "zestops-payment-api"),
		JWTPublicKey:               publicKey,
		RateLimitRequestsPerMinute: rateLimit,
		TrustedProxies:             splitCommaSeparated(os.Getenv("TRUSTED_PROXIES")),
	}, nil
}

// ParseEd25519PublicKeyBase64 decodes a base64-encoded PEM (SPKI) Ed25519 public key.
func ParseEd25519PublicKeyBase64(encodedKey string) (ed25519.PublicKey, error) {
	if strings.TrimSpace(encodedKey) == "" {
		return nil, errors.New("is required")
	}
	pemBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encodedKey))
	if err != nil {
		return nil, fmt.Errorf("is not valid base64: %w", err)
	}
	block, _ := pem.Decode(pemBytes)
	if block == nil || block.Type != "PUBLIC KEY" {
		return nil, errors.New("does not contain a PEM PUBLIC KEY block")
	}
	parsedKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("cannot be parsed: %w", err)
	}
	publicKey, isEd25519 := parsedKey.(ed25519.PublicKey)
	if !isEd25519 {
		return nil, errors.New("is not an Ed25519 key")
	}
	return publicKey, nil
}

func readWithDefault(name string, defaultValue string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue
	}
	return value
}

func splitCommaSeparated(value string) []string {
	var items []string
	for _, item := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			items = append(items, trimmed)
		}
	}
	return items
}
