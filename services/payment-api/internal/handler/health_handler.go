package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// DatabasePinger is anything that can check database connectivity.
type DatabasePinger interface {
	Ping(ctx context.Context) error
}

// HealthHandler serves the public health endpoints. They reveal nothing
// sensitive (no versions, hostnames or error messages).
type HealthHandler struct {
	database DatabasePinger
}

// NewHealthHandler creates the handler.
func NewHealthHandler(database DatabasePinger) *HealthHandler {
	return &HealthHandler{database: database}
}

// Live answers "is the process running?" (used by container restarts).
func (healthHandler *HealthHandler) Live(context *gin.Context) {
	context.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Ready answers "can the service handle traffic?" (database reachable).
func (healthHandler *HealthHandler) Ready(ginContext *gin.Context) {
	pingContext, cancel := context.WithTimeout(ginContext.Request.Context(), 2*time.Second)
	defer cancel()

	if err := healthHandler.database.Ping(pingContext); err != nil {
		ginContext.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "unavailable",
			"checks": gin.H{"database": "unavailable"},
		})
		return
	}
	ginContext.JSON(http.StatusOK, gin.H{"status": "ok", "checks": gin.H{"database": "ok"}})
}
