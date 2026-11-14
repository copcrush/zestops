package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

const (
	testIssuer   = "zestops-web"
	testAudience = "zestops-payment-api"
)

type tokenOptions struct {
	issuer    string
	audience  string
	subject   string
	role      string
	issuedAt  time.Time
	expiresAt time.Time
}

func defaultTokenOptions() tokenOptions {
	now := time.Now()
	return tokenOptions{
		issuer:    testIssuer,
		audience:  testAudience,
		subject:   uuid.NewString(),
		role:      RoleAdmin,
		issuedAt:  now,
		expiresAt: now.Add(2 * time.Minute),
	}
}

func signToken(t *testing.T, privateKey ed25519.PrivateKey, options tokenOptions) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":  options.issuer,
		"aud":  options.audience,
		"sub":  options.subject,
		"role": options.role,
		"iat":  options.issuedAt.Unix(),
		"exp":  options.expiresAt.Unix(),
	}
	signedToken, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(privateKey)
	require.NoError(t, err)
	return signedToken
}

func newKeyPair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	return publicKey, privateKey
}

func TestVerifyAcceptsValidToken(t *testing.T) {
	publicKey, privateKey := newKeyPair(t)
	verifier := NewTokenVerifier(publicKey, testIssuer, testAudience)
	options := defaultTokenOptions()
	options.role = RoleViewer

	principal, err := verifier.Verify(signToken(t, privateKey, options))

	require.NoError(t, err)
	require.Equal(t, options.subject, principal.UserID.String())
	require.Equal(t, RoleViewer, principal.Role)
	require.False(t, principal.IsAdmin())
}

func TestVerifyRejectsInvalidTokens(t *testing.T) {
	publicKey, privateKey := newKeyPair(t)
	_, otherPrivateKey := newKeyPair(t)
	verifier := NewTokenVerifier(publicKey, testIssuer, testAudience)

	testCases := []struct {
		name        string
		createToken func() string
	}{
		{"wrong issuer", func() string {
			options := defaultTokenOptions()
			options.issuer = "evil-issuer"
			return signToken(t, privateKey, options)
		}},
		{"wrong audience (token meant for another service)", func() string {
			options := defaultTokenOptions()
			options.audience = "zestops-monitoring-api"
			return signToken(t, privateKey, options)
		}},
		{"expired", func() string {
			options := defaultTokenOptions()
			options.issuedAt = time.Now().Add(-4 * time.Minute)
			options.expiresAt = time.Now().Add(-2 * time.Minute)
			return signToken(t, privateKey, options)
		}},
		{"lifetime longer than allowed", func() string {
			options := defaultTokenOptions()
			options.expiresAt = options.issuedAt.Add(time.Hour)
			return signToken(t, privateKey, options)
		}},
		{"signed by a different key", func() string {
			return signToken(t, otherPrivateKey, defaultTokenOptions())
		}},
		{"unknown role", func() string {
			options := defaultTokenOptions()
			options.role = "superuser"
			return signToken(t, privateKey, options)
		}},
		{"subject is not a UUID", func() string {
			options := defaultTokenOptions()
			options.subject = "admin"
			return signToken(t, privateKey, options)
		}},
		{"tampered payload", func() string {
			validToken := signToken(t, privateKey, defaultTokenOptions())
			return validToken[:len(validToken)-4] + "AAAA"
		}},
		{"alg none", func() string {
			claims := jwt.MapClaims{"iss": testIssuer, "aud": testAudience, "sub": uuid.NewString(),
				"role": RoleAdmin, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix()}
			unsignedToken, err := jwt.NewWithClaims(jwt.SigningMethodNone, claims).SignedString(jwt.UnsafeAllowNoneSignatureType)
			require.NoError(t, err)
			return unsignedToken
		}},
		{"algorithm confusion: HS256 signed with the public key", func() string {
			claims := jwt.MapClaims{"iss": testIssuer, "aud": testAudience, "sub": uuid.NewString(),
				"role": RoleAdmin, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix()}
			hmacToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(publicKey))
			require.NoError(t, err)
			return hmacToken
		}},
		{"RS256 token", func() string {
			rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
			require.NoError(t, err)
			claims := jwt.MapClaims{"iss": testIssuer, "aud": testAudience, "sub": uuid.NewString(),
				"role": RoleAdmin, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix()}
			rsaToken, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(rsaKey)
			require.NoError(t, err)
			return rsaToken
		}},
		{"missing expiry", func() string {
			claims := jwt.MapClaims{"iss": testIssuer, "aud": testAudience, "sub": uuid.NewString(),
				"role": RoleAdmin, "iat": time.Now().Unix()}
			tokenWithoutExpiry, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(privateKey)
			require.NoError(t, err)
			return tokenWithoutExpiry
		}},
		{"garbage", func() string { return "not-a-jwt" }},
		{"empty", func() string { return "" }},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := verifier.Verify(testCase.createToken())
			require.Error(t, err)
			require.True(t, errors.Is(err, ErrInvalidToken), "error should wrap ErrInvalidToken, got %v", err)
		})
	}
}
