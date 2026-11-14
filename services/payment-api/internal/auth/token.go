// Package auth verifies the short-lived internal JWTs that the web app (BFF)
// signs for every request it forwards to this service.
//
// Security rules enforced here (see docs/architecture/AUTH.md):
//   - only the EdDSA (Ed25519) algorithm is accepted ("none", HS256, RS256 are rejected)
//   - signature, issuer, audience, expiry and not-before are verified
//   - tokens may live at most MaximumTokenLifetime
//   - the role must be one this service understands
//
// The service never trusts a user ID or role sent any other way.
package auth

import (
	"crypto/ed25519"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Roles understood by the Payment API.
const (
	RoleAdmin  = "admin"
	RoleViewer = "viewer"
)

// MaximumTokenLifetime limits the damage if an internal token ever leaks.
const MaximumTokenLifetime = 5 * time.Minute

// clockSkewLeeway tolerates small clock differences between servers.
const clockSkewLeeway = 30 * time.Second

// ErrInvalidToken is returned for every verification failure. The detailed
// reason is logged, never returned to the caller.
var ErrInvalidToken = errors.New("invalid internal token")

// Principal is the authenticated caller of a request.
type Principal struct {
	UserID uuid.UUID
	Role   string
}

// IsAdmin reports whether the principal has the admin role.
func (principal Principal) IsAdmin() bool {
	return principal.Role == RoleAdmin
}

type internalClaims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

// TokenVerifier validates internal JWTs.
type TokenVerifier struct {
	publicKey ed25519.PublicKey
	issuer    string
	audience  string
	now       func() time.Time
}

// NewTokenVerifier creates a verifier for the given key, issuer and audience.
func NewTokenVerifier(publicKey ed25519.PublicKey, issuer string, audience string) *TokenVerifier {
	return &TokenVerifier{publicKey: publicKey, issuer: issuer, audience: audience, now: time.Now}
}

// Verify parses and validates a raw JWT and returns the principal it describes.
// The returned error wraps ErrInvalidToken and explains the reason (for logs).
func (verifier *TokenVerifier) Verify(rawToken string) (Principal, error) {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(verifier.issuer),
		jwt.WithAudience(verifier.audience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(clockSkewLeeway),
		jwt.WithTimeFunc(verifier.now),
	)

	claims := &internalClaims{}
	_, err := parser.ParseWithClaims(rawToken, claims, func(token *jwt.Token) (any, error) {
		return verifier.publicKey, nil
	})
	if err != nil {
		return Principal{}, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}

	if claims.IssuedAt == nil {
		return Principal{}, fmt.Errorf("%w: missing iat claim", ErrInvalidToken)
	}
	if claims.ExpiresAt.Sub(claims.IssuedAt.Time) > MaximumTokenLifetime {
		return Principal{}, fmt.Errorf("%w: token lifetime exceeds %s", ErrInvalidToken, MaximumTokenLifetime)
	}

	userID, err := uuid.Parse(claims.Subject)
	if err != nil {
		return Principal{}, fmt.Errorf("%w: subject is not a UUID", ErrInvalidToken)
	}

	if claims.Role != RoleAdmin && claims.Role != RoleViewer {
		return Principal{}, fmt.Errorf("%w: unknown role %q", ErrInvalidToken, claims.Role)
	}

	return Principal{UserID: userID, Role: claims.Role}, nil
}
