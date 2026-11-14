// Package logging configures structured JSON logging with log/slog.
package logging

import (
	"io"
	"log/slog"
)

// NewLogger returns a JSON logger. Every log line is one JSON object, which
// hosting platforms (Render, Docker) can search and filter.
func NewLogger(output io.Writer, level string) *slog.Logger {
	var slogLevel slog.Level
	switch level {
	case "debug":
		slogLevel = slog.LevelDebug
	case "warn":
		slogLevel = slog.LevelWarn
	case "error":
		slogLevel = slog.LevelError
	default:
		slogLevel = slog.LevelInfo
	}
	handler := slog.NewJSONHandler(output, &slog.HandlerOptions{Level: slogLevel})
	return slog.New(handler).With("service", "payment-api")
}
