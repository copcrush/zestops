package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// testUser is a caller with a role, identified by a random UUID.
type testUser struct {
	ID   uuid.UUID
	Role string
}

func newAdmin() testUser  { return testUser{ID: uuid.New(), Role: "admin"} }
func newViewer() testUser { return testUser{ID: uuid.New(), Role: "viewer"} }

// token mints an internal JWT exactly like the web BFF does.
func (user testUser) token(t *testing.T) string {
	t.Helper()
	now := time.Now()
	claims := jwt.MapClaims{
		"iss":  testIssuer,
		"aud":  testAudience,
		"sub":  user.ID.String(),
		"role": user.Role,
		"iat":  now.Unix(),
		"nbf":  now.Unix(),
		"exp":  now.Add(2 * time.Minute).Unix(),
		"jti":  uuid.NewString(),
	}
	signedToken, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(signingKey)
	require.NoError(t, err)
	return signedToken
}

// resetDatabase removes all payments so each test starts clean.
// TRUNCATE needs the owner role; the application role cannot do it.
func resetDatabase(t *testing.T) {
	t.Helper()
	_, err := ownerPool.Exec(context.Background(),
		`TRUNCATE payments.payment_events, payments.payments RESTART IDENTITY CASCADE`)
	require.NoError(t, err)
}

type requestOptions struct {
	method         string
	path           string
	user           *testUser
	body           any
	rawBody        []byte
	contentType    string
	idempotencyKey string
}

func sendRequest(t *testing.T, options requestOptions) *httptest.ResponseRecorder {
	t.Helper()
	var bodyReader *bytes.Reader
	switch {
	case options.rawBody != nil:
		bodyReader = bytes.NewReader(options.rawBody)
	case options.body != nil:
		encodedBody, err := json.Marshal(options.body)
		require.NoError(t, err)
		bodyReader = bytes.NewReader(encodedBody)
	default:
		bodyReader = bytes.NewReader(nil)
	}

	request := httptest.NewRequest(options.method, options.path, bodyReader)
	if options.body != nil || options.rawBody != nil {
		contentType := options.contentType
		if contentType == "" {
			contentType = "application/json"
		}
		request.Header.Set("Content-Type", contentType)
	}
	if options.user != nil {
		request.Header.Set("Authorization", "Bearer "+options.user.token(t))
	}
	if options.idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", options.idempotencyKey)
	}

	recorder := httptest.NewRecorder()
	testRouter.ServeHTTP(recorder, request)
	return recorder
}

// paymentResponse mirrors the JSON returned for a payment.
type paymentResponse struct {
	ID                string  `json:"id"`
	Reference         string  `json:"reference"`
	MerchantReference string  `json:"merchant_reference"`
	Description       string  `json:"description"`
	AmountMinor       int64   `json:"amount_minor"`
	Currency          string  `json:"currency"`
	PaymentMethod     string  `json:"payment_method"`
	Status            string  `json:"status"`
	FailureReason     *string `json:"failure_reason"`
	CreatedBy         string  `json:"created_by"`
	CompletedAt       *string `json:"completed_at"`
}

type errorResponse struct {
	Error struct {
		Code      string          `json:"code"`
		Message   string          `json:"message"`
		RequestID string          `json:"request_id"`
		Details   json.RawMessage `json:"details"`
	} `json:"error"`
}

func decodeJSON[T any](t *testing.T, recorder *httptest.ResponseRecorder) T {
	t.Helper()
	var decoded T
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &decoded), "body: %s", recorder.Body.String())
	return decoded
}

func decodePayment(t *testing.T, recorder *httptest.ResponseRecorder) paymentResponse {
	t.Helper()
	return decodeJSON[struct {
		Data paymentResponse `json:"data"`
	}](t, recorder).Data
}

func decodeErrorCode(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	return decodeJSON[errorResponse](t, recorder).Error.Code
}

func validPaymentBody() map[string]any {
	return map[string]any{
		"merchant_reference": "ORDER-1001",
		"description":        "Integration test order",
		"amount_minor":       125050,
		"currency":           "THB",
		"payment_method":     "promptpay",
	}
}

func createPayment(t *testing.T, user testUser, idempotencyKey string, body map[string]any) paymentResponse {
	t.Helper()
	recorder := sendRequest(t, requestOptions{
		method: http.MethodPost, path: "/v1/payments", user: &user, body: body, idempotencyKey: idempotencyKey,
	})
	require.Equal(t, http.StatusCreated, recorder.Code, recorder.Body.String())
	return decodePayment(t, recorder)
}

func countRows(t *testing.T, query string, arguments ...any) int {
	t.Helper()
	var count int
	require.NoError(t, ownerPool.QueryRow(context.Background(), query, arguments...).Scan(&count))
	return count
}
