package middleware

import (
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// RateLimiter limits requests per authenticated user (or per client IP when
// there is no user yet) with a token bucket.
//
// Limitation: counters live in this process's memory. With several instances
// each instance has its own counters (documented in KNOWN_LIMITATIONS.md).
type RateLimiter struct {
	mutex             sync.Mutex
	limiters          map[string]*clientLimiter
	requestsPerMinute int
	idleExpiry        time.Duration
	lastCleanup       time.Time
}

type clientLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// NewRateLimiter allows requestsPerMinute per client, with bursts up to the same size.
func NewRateLimiter(requestsPerMinute int) *RateLimiter {
	return &RateLimiter{
		limiters:          map[string]*clientLimiter{},
		requestsPerMinute: requestsPerMinute,
		idleExpiry:        10 * time.Minute,
		lastCleanup:       time.Now(),
	}
}

func (rateLimiter *RateLimiter) limiterFor(clientKey string) *rate.Limiter {
	rateLimiter.mutex.Lock()
	defer rateLimiter.mutex.Unlock()

	now := time.Now()
	if now.Sub(rateLimiter.lastCleanup) > time.Minute {
		for key, entry := range rateLimiter.limiters {
			if now.Sub(entry.lastSeen) > rateLimiter.idleExpiry {
				delete(rateLimiter.limiters, key)
			}
		}
		rateLimiter.lastCleanup = now
	}

	entry, exists := rateLimiter.limiters[clientKey]
	if !exists {
		requestsPerSecond := rate.Limit(float64(rateLimiter.requestsPerMinute) / 60)
		entry = &clientLimiter{limiter: rate.NewLimiter(requestsPerSecond, rateLimiter.requestsPerMinute)}
		rateLimiter.limiters[clientKey] = entry
	}
	entry.lastSeen = now
	return entry.limiter
}

// Middleware returns the Gin middleware. Place it after Authenticate so the
// limit applies per user.
func (rateLimiter *RateLimiter) Middleware() gin.HandlerFunc {
	return func(context *gin.Context) {
		clientKey := "ip:" + context.ClientIP()
		if principal, ok := GetPrincipal(context); ok {
			clientKey = "user:" + principal.UserID.String()
		}

		reservation := rateLimiter.limiterFor(clientKey).Reserve()
		if delay := reservation.Delay(); delay > 0 {
			reservation.Cancel()
			retryAfterSeconds := int(math.Ceil(delay.Seconds()))
			context.Header("Retry-After", strconv.Itoa(retryAfterSeconds))
			AbortWithError(context, http.StatusTooManyRequests, "RATE_LIMITED",
				"Too many requests. Please slow down.", nil)
			return
		}
		context.Next()
	}
}
