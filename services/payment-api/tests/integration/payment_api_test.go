package integration

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHealthEndpoints(t *testing.T) {
	live := sendRequest(t, requestOptions{method: http.MethodGet, path: "/health/live"})
	require.Equal(t, http.StatusOK, live.Code)

	ready := sendRequest(t, requestOptions{method: http.MethodGet, path: "/health/ready"})
	require.Equal(t, http.StatusOK, ready.Code)
	require.JSONEq(t, `{"status":"ok","checks":{"database":"ok"}}`, ready.Body.String())
}

func TestSecurityHeadersAndRequestIDArePresent(t *testing.T) {
	recorder := sendRequest(t, requestOptions{method: http.MethodGet, path: "/v1/payments"})

	require.Equal(t, "nosniff", recorder.Header().Get("X-Content-Type-Options"))
	require.Equal(t, "DENY", recorder.Header().Get("X-Frame-Options"))
	require.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
	require.Empty(t, recorder.Header().Get("Access-Control-Allow-Origin"), "CORS must not be enabled")
	requestID := recorder.Header().Get("X-Request-ID")
	require.NotEmpty(t, requestID)
	require.Equal(t, requestID, decodeJSON[errorResponse](t, recorder).Error.RequestID)
}

func TestAuthenticationIsRequired(t *testing.T) {
	protectedRoutes := []struct{ method, path string }{
		{http.MethodGet, "/v1/payments"},
		{http.MethodGet, "/v1/payments/summary"},
		{http.MethodGet, "/v1/currencies"},
		{http.MethodPost, "/v1/payments"},
		{http.MethodPost, "/v1/payments/00000000-0000-4000-8000-000000000000/simulate"},
	}
	for _, route := range protectedRoutes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			recorder := sendRequest(t, requestOptions{method: route.method, path: route.path})
			require.Equal(t, http.StatusUnauthorized, recorder.Code)
			require.Equal(t, "UNAUTHENTICATED", decodeErrorCode(t, recorder))
		})
	}

	request := sendRequestWithHeader(t, http.MethodGet, "/v1/payments", "Authorization", "Bearer not.a.jwt")
	require.Equal(t, http.StatusUnauthorized, request.Code)

	request = sendRequestWithHeader(t, http.MethodGet, "/v1/payments", "Authorization", "Basic YWRtaW46YWRtaW4=")
	require.Equal(t, http.StatusUnauthorized, request.Code)
}

func TestViewerCanReadButCannotChangePayments(t *testing.T) {
	resetDatabase(t)
	admin, viewer := newAdmin(), newViewer()
	payment := createPayment(t, admin, "viewer-test-key-1", validPaymentBody())

	readRoutes := []string{"/v1/payments", "/v1/payments/summary", "/v1/currencies",
		"/v1/payments/" + payment.ID, "/v1/payments/" + payment.ID + "/status"}
	for _, path := range readRoutes {
		recorder := sendRequest(t, requestOptions{method: http.MethodGet, path: path, user: &viewer})
		require.Equal(t, http.StatusOK, recorder.Code, "viewer GET %s", path)
	}

	writeRequests := []requestOptions{
		{method: http.MethodPost, path: "/v1/payments", body: validPaymentBody(), idempotencyKey: "viewer-key-0001"},
		{method: http.MethodPost, path: "/v1/payments/" + payment.ID + "/simulate", body: map[string]any{"outcome": "succeeded"}},
		{method: http.MethodPost, path: "/v1/payments/" + payment.ID + "/cancel"},
	}
	for _, writeRequest := range writeRequests {
		writeRequest.user = &viewer
		recorder := sendRequest(t, writeRequest)
		require.Equal(t, http.StatusForbidden, recorder.Code, "viewer %s %s", writeRequest.method, writeRequest.path)
		require.Equal(t, "FORBIDDEN", decodeErrorCode(t, recorder))
	}

	require.Equal(t, 1, countRows(t, `SELECT count(*) FROM payments.payments`))
	require.Equal(t, "pending", decodePayment(t, sendRequest(t, requestOptions{
		method: http.MethodGet, path: "/v1/payments/" + payment.ID + "/status", user: &viewer})).Status)
}

func TestCreatePaymentPersistsPaymentAndHistory(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()

	recorder := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments", user: &admin,
		body: validPaymentBody(), idempotencyKey: "create-key-0001"})

	require.Equal(t, http.StatusCreated, recorder.Code, recorder.Body.String())
	payment := decodePayment(t, recorder)
	require.Equal(t, "/v1/payments/"+payment.ID, recorder.Header().Get("Location"))
	require.Equal(t, "pending", payment.Status)
	require.Equal(t, int64(125050), payment.AmountMinor)
	require.Equal(t, "THB", payment.Currency)
	require.Equal(t, admin.ID.String(), payment.CreatedBy, "created_by comes from the token, not the body")
	require.Regexp(t, `^PAY-[0-9A-Z]{10}$`, payment.Reference)
	require.Nil(t, payment.CompletedAt)

	details := sendRequest(t, requestOptions{method: http.MethodGet, path: "/v1/payments/" + payment.ID, user: &admin})
	require.Equal(t, http.StatusOK, details.Code)
	body := decodeJSON[struct {
		Data struct {
			Payment paymentResponse `json:"payment"`
			Events  []struct {
				FromStatus *string `json:"from_status"`
				ToStatus   string  `json:"to_status"`
				ActorID    string  `json:"actor_id"`
				RequestID  *string `json:"request_id"`
			} `json:"events"`
		} `json:"data"`
	}](t, details)
	require.Len(t, body.Data.Events, 1)
	require.Nil(t, body.Data.Events[0].FromStatus)
	require.Equal(t, "pending", body.Data.Events[0].ToStatus)
	require.Equal(t, admin.ID.String(), body.Data.Events[0].ActorID)
	require.NotNil(t, body.Data.Events[0].RequestID, "events keep the request ID for tracing")
}

func TestCreatePaymentIgnoresClientSuppliedIdentityFields(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	body := validPaymentBody()
	body["created_by"] = "00000000-0000-4000-8000-000000000999"

	recorder := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments", user: &admin,
		body: body, idempotencyKey: "spoof-key-0001"})

	require.Equal(t, http.StatusBadRequest, recorder.Code, "unknown fields such as created_by are rejected")
	require.Equal(t, "INVALID_JSON", decodeErrorCode(t, recorder))
	require.Equal(t, 0, countRows(t, `SELECT count(*) FROM payments.payments`))
}

func TestIdempotentRetryReturnsTheSamePayment(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	firstPayment := createPayment(t, admin, "retry-key-0001", validPaymentBody())

	retry := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments", user: &admin,
		body: validPaymentBody(), idempotencyKey: "retry-key-0001"})

	require.Equal(t, http.StatusOK, retry.Code)
	require.Equal(t, "true", retry.Header().Get("Idempotent-Replayed"))
	require.Equal(t, firstPayment.ID, decodePayment(t, retry).ID)
	require.Equal(t, 1, countRows(t, `SELECT count(*) FROM payments.payments`))
	require.Equal(t, 1, countRows(t, `SELECT count(*) FROM payments.payment_events`))
}

func TestIdempotencyKeyReusedWithDifferentBodyIsRejected(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	createPayment(t, admin, "reuse-key-0001", validPaymentBody())

	changedBody := validPaymentBody()
	changedBody["amount_minor"] = 999
	recorder := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments", user: &admin,
		body: changedBody, idempotencyKey: "reuse-key-0001"})

	require.Equal(t, http.StatusUnprocessableEntity, recorder.Code)
	require.Equal(t, "IDEMPOTENCY_KEY_REUSED", decodeErrorCode(t, recorder))
	require.Equal(t, 1, countRows(t, `SELECT count(*) FROM payments.payments`))
}

func TestIdempotencyKeysAreScopedPerUser(t *testing.T) {
	resetDatabase(t)
	firstAdmin, secondAdmin := newAdmin(), newAdmin()

	firstPayment := createPayment(t, firstAdmin, "shared-key-0001", validPaymentBody())
	secondPayment := createPayment(t, secondAdmin, "shared-key-0001", validPaymentBody())

	require.NotEqual(t, firstPayment.ID, secondPayment.ID)
	require.Equal(t, 2, countRows(t, `SELECT count(*) FROM payments.payments`))
}

// Many identical requests at the same moment (e.g. a double-clicked button or
// an aggressive client retry) must still create exactly one payment.
func TestConcurrentCreatesWithSameIdempotencyKeyCreateOnePayment(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	const parallelRequests = 25

	var waitGroup sync.WaitGroup
	startSignal := make(chan struct{})
	statusCodes := make([]int, parallelRequests)
	paymentIDs := make([]string, parallelRequests)

	for requestIndex := range parallelRequests {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-startSignal
			recorder := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments", user: &admin,
				body: validPaymentBody(), idempotencyKey: "concurrent-key-0001"})
			statusCodes[requestIndex] = recorder.Code
			if recorder.Code == http.StatusCreated || recorder.Code == http.StatusOK {
				paymentIDs[requestIndex] = decodePayment(t, recorder).ID
			}
		}()
	}
	close(startSignal)
	waitGroup.Wait()

	createdCount, replayedCount := 0, 0
	for requestIndex, statusCode := range statusCodes {
		switch statusCode {
		case http.StatusCreated:
			createdCount++
		case http.StatusOK:
			replayedCount++
		default:
			t.Fatalf("request %d returned unexpected status %d", requestIndex, statusCode)
		}
		require.Equal(t, paymentIDs[0], paymentIDs[requestIndex], "every response must reference the same payment")
	}
	require.Equal(t, 1, createdCount)
	require.Equal(t, parallelRequests-1, replayedCount)
	require.Equal(t, 1, countRows(t, `SELECT count(*) FROM payments.payments`))
	require.Equal(t, 1, countRows(t, `SELECT count(*) FROM payments.payment_events`))
}

func TestSimulateSuccessfulPayment(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	payment := createPayment(t, admin, "simulate-ok-0001", validPaymentBody())

	recorder := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments/" + payment.ID + "/simulate",
		user: &admin, body: map[string]any{"outcome": "succeeded"}})

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	settledPayment := decodePayment(t, recorder)
	require.Equal(t, "succeeded", settledPayment.Status)
	require.NotNil(t, settledPayment.CompletedAt)
	require.Nil(t, settledPayment.FailureReason)
	require.Equal(t, 3, countRows(t, `SELECT count(*) FROM payments.payment_events WHERE payment_id = $1`, payment.ID))
	require.Equal(t, 1, countRows(t,
		`SELECT count(*) FROM payments.payment_events WHERE payment_id = $1 AND from_status = 'pending' AND to_status = 'processing'`, payment.ID))
}

func TestSimulateFailedPayment(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	firstPayment := createPayment(t, admin, "simulate-fail-0001", validPaymentBody())
	secondPayment := createPayment(t, admin, "simulate-fail-0002", validPaymentBody())

	withReason := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments/" + firstPayment.ID + "/simulate",
		user: &admin, body: map[string]any{"outcome": "failed", "failure_reason": "Card declined"}})
	withoutReason := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments/" + secondPayment.ID + "/simulate",
		user: &admin, body: map[string]any{"outcome": "failed"}})

	require.Equal(t, http.StatusOK, withReason.Code)
	require.Equal(t, "failed", decodePayment(t, withReason).Status)
	require.Equal(t, "Card declined", *decodePayment(t, withReason).FailureReason)
	require.Equal(t, "Simulated failure", *decodePayment(t, withoutReason).FailureReason)
}

func TestSettledPaymentCannotBeSimulatedOrCancelledAgain(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	payment := createPayment(t, admin, "settled-key-0001", validPaymentBody())
	simulatePath := "/v1/payments/" + payment.ID + "/simulate"
	require.Equal(t, http.StatusOK, sendRequest(t, requestOptions{method: http.MethodPost, path: simulatePath,
		user: &admin, body: map[string]any{"outcome": "succeeded"}}).Code)

	again := sendRequest(t, requestOptions{method: http.MethodPost, path: simulatePath, user: &admin,
		body: map[string]any{"outcome": "failed"}})
	require.Equal(t, http.StatusConflict, again.Code)
	require.Equal(t, "INVALID_STATE_TRANSITION", decodeErrorCode(t, again))

	cancel := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments/" + payment.ID + "/cancel", user: &admin})
	require.Equal(t, http.StatusConflict, cancel.Code)

	status := decodePayment(t, sendRequest(t, requestOptions{method: http.MethodGet,
		path: "/v1/payments/" + payment.ID + "/status", user: &admin}))
	require.Equal(t, "succeeded", status.Status, "a settled payment never changes")
}

// Two admins pressing "simulate" at the same time must not settle a payment twice.
func TestConcurrentSimulationsSettleAPaymentExactlyOnce(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	payment := createPayment(t, admin, "race-key-0001", validPaymentBody())
	const parallelRequests = 20

	var waitGroup sync.WaitGroup
	startSignal := make(chan struct{})
	statusCodes := make([]int, parallelRequests)
	for requestIndex := range parallelRequests {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			outcome := "succeeded"
			if requestIndex%2 == 0 {
				outcome = "failed"
			}
			<-startSignal
			statusCodes[requestIndex] = sendRequest(t, requestOptions{method: http.MethodPost,
				path: "/v1/payments/" + payment.ID + "/simulate", user: &admin,
				body: map[string]any{"outcome": outcome}}).Code
		}()
	}
	close(startSignal)
	waitGroup.Wait()

	successCount, conflictCount := 0, 0
	for _, statusCode := range statusCodes {
		switch statusCode {
		case http.StatusOK:
			successCount++
		case http.StatusConflict:
			conflictCount++
		default:
			t.Fatalf("unexpected status %d", statusCode)
		}
	}
	require.Equal(t, 1, successCount)
	require.Equal(t, parallelRequests-1, conflictCount)
	// created + processing + final outcome, nothing more.
	require.Equal(t, 3, countRows(t, `SELECT count(*) FROM payments.payment_events WHERE payment_id = $1`, payment.ID))
}

func TestCancelPendingPayment(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	payment := createPayment(t, admin, "cancel-key-0001", validPaymentBody())

	recorder := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments/" + payment.ID + "/cancel", user: &admin})
	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "cancelled", decodePayment(t, recorder).Status)

	simulate := sendRequest(t, requestOptions{method: http.MethodPost, path: "/v1/payments/" + payment.ID + "/simulate",
		user: &admin, body: map[string]any{"outcome": "succeeded"}})
	require.Equal(t, http.StatusConflict, simulate.Code)
}

func TestCreatePaymentValidation(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()

	testCases := []struct {
		name           string
		options        requestOptions
		expectedStatus int
		expectedCode   string
	}{
		{"missing idempotency key", requestOptions{body: validPaymentBody()}, http.StatusBadRequest, "VALIDATION_ERROR"},
		{"malformed JSON", requestOptions{rawBody: []byte(`{"amount_minor":`), idempotencyKey: "validation-0001"}, http.StatusBadRequest, "INVALID_JSON"},
		{"two JSON objects", requestOptions{rawBody: []byte(`{} {}`), idempotencyKey: "validation-0002"}, http.StatusBadRequest, "INVALID_JSON"},
		{"floating point amount", requestOptions{rawBody: []byte(`{"merchant_reference":"A","amount_minor":12.5,"currency":"THB","payment_method":"card"}`), idempotencyKey: "validation-0003"}, http.StatusBadRequest, "INVALID_JSON"},
		{"amount as string", requestOptions{rawBody: []byte(`{"merchant_reference":"A","amount_minor":"1250","currency":"THB","payment_method":"card"}`), idempotencyKey: "validation-0004"}, http.StatusBadRequest, "INVALID_JSON"},
		{"wrong content type", requestOptions{rawBody: []byte(`{}`), contentType: "text/plain", idempotencyKey: "validation-0005"}, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE"},
		{"unsupported currency", requestOptions{body: map[string]any{"merchant_reference": "A", "amount_minor": 100, "currency": "XXX", "payment_method": "card"}, idempotencyKey: "validation-0006"}, http.StatusBadRequest, "VALIDATION_ERROR"},
		{"payload too large", requestOptions{rawBody: []byte(`{"description":"` + strings.Repeat("a", 70*1024) + `"}`), idempotencyKey: "validation-0007"}, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			options := testCase.options
			options.method, options.path, options.user = http.MethodPost, "/v1/payments", &admin
			recorder := sendRequest(t, options)
			require.Equal(t, testCase.expectedStatus, recorder.Code, recorder.Body.String())
			require.Equal(t, testCase.expectedCode, decodeErrorCode(t, recorder))
		})
	}
	require.Equal(t, 0, countRows(t, `SELECT count(*) FROM payments.payments`))
}

func TestGetPaymentErrors(t *testing.T) {
	admin := newAdmin()

	notFound := sendRequest(t, requestOptions{method: http.MethodGet, path: "/v1/payments/00000000-0000-4000-8000-000000000123", user: &admin})
	require.Equal(t, http.StatusNotFound, notFound.Code)
	require.Equal(t, "PAYMENT_NOT_FOUND", decodeErrorCode(t, notFound))

	invalidID := sendRequest(t, requestOptions{method: http.MethodGet, path: "/v1/payments/not-a-uuid", user: &admin})
	require.Equal(t, http.StatusBadRequest, invalidID.Code)
}

type paymentPage struct {
	Data       []paymentResponse `json:"data"`
	NextCursor *string           `json:"next_cursor"`
}

func TestListPaymentsPaginatesWithoutDuplicates(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	for paymentNumber := 1; paymentNumber <= 7; paymentNumber++ {
		body := validPaymentBody()
		body["merchant_reference"] = fmt.Sprintf("PAGE-%02d", paymentNumber)
		createPayment(t, admin, fmt.Sprintf("page-key-%04d", paymentNumber), body)
	}

	seenReferences := map[string]bool{}
	path := "/v1/payments?limit=3"
	pageCount := 0
	for {
		recorder := sendRequest(t, requestOptions{method: http.MethodGet, path: path, user: &admin})
		require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
		page := decodeJSON[paymentPage](t, recorder)
		pageCount++
		for _, payment := range page.Data {
			require.False(t, seenReferences[payment.MerchantReference], "duplicate across pages")
			seenReferences[payment.MerchantReference] = true
		}
		if page.NextCursor == nil {
			break
		}
		path = "/v1/payments?limit=3&cursor=" + url.QueryEscape(*page.NextCursor)
	}

	require.Equal(t, 3, pageCount)
	require.Len(t, seenReferences, 7)
}

func TestListPaymentsFilters(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	invoiceBody := validPaymentBody()
	invoiceBody["merchant_reference"] = "INV-100"
	invoicePayment := createPayment(t, admin, "filter-key-0001", invoiceBody)
	createPayment(t, admin, "filter-key-0002", validPaymentBody())
	require.Equal(t, http.StatusOK, sendRequest(t, requestOptions{method: http.MethodPost,
		path: "/v1/payments/" + invoicePayment.ID + "/simulate", user: &admin, body: map[string]any{"outcome": "succeeded"}}).Code)

	byStatus := decodeJSON[paymentPage](t, sendRequest(t, requestOptions{method: http.MethodGet, path: "/v1/payments?status=succeeded", user: &admin}))
	require.Len(t, byStatus.Data, 1)
	require.Equal(t, invoicePayment.ID, byStatus.Data[0].ID)

	byMerchantPrefix := decodeJSON[paymentPage](t, sendRequest(t, requestOptions{method: http.MethodGet, path: "/v1/payments?search=inv-", user: &admin}))
	require.Len(t, byMerchantPrefix.Data, 1)

	byReference := decodeJSON[paymentPage](t, sendRequest(t, requestOptions{method: http.MethodGet,
		path: "/v1/payments?search=" + strings.ToLower(invoicePayment.Reference), user: &admin}))
	require.Len(t, byReference.Data, 1)

	for _, invalidQuery := range []string{"status=refunded", "limit=0", "limit=101", "limit=abc", "cursor=bogus", "search=" + url.QueryEscape("%' OR 1=1--")} {
		recorder := sendRequest(t, requestOptions{method: http.MethodGet, path: "/v1/payments?" + invalidQuery, user: &admin})
		require.Equal(t, http.StatusBadRequest, recorder.Code, invalidQuery)
	}
}

func TestPaymentSummary(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	succeededPayment := createPayment(t, admin, "summary-key-0001", validPaymentBody())
	failedPayment := createPayment(t, admin, "summary-key-0002", validPaymentBody())
	createPayment(t, admin, "summary-key-0003", validPaymentBody())
	for paymentID, outcome := range map[string]string{succeededPayment.ID: "succeeded", failedPayment.ID: "failed"} {
		require.Equal(t, http.StatusOK, sendRequest(t, requestOptions{method: http.MethodPost,
			path: "/v1/payments/" + paymentID + "/simulate", user: &admin, body: map[string]any{"outcome": outcome}}).Code)
	}

	recorder := sendRequest(t, requestOptions{method: http.MethodGet, path: "/v1/payments/summary", user: &admin})
	require.Equal(t, http.StatusOK, recorder.Code)
	summary := decodeJSON[struct {
		Data struct {
			TotalCount         int              `json:"total_count"`
			CountByStatus      map[string]int   `json:"count_by_status"`
			CreatedLast24Hours int              `json:"created_last_24_hours"`
			SuccessRatePercent *float64         `json:"success_rate_percent"`
			SucceededTotals    []map[string]any `json:"succeeded_totals"`
		} `json:"data"`
	}](t, recorder).Data

	require.Equal(t, 3, summary.TotalCount)
	require.Equal(t, 1, summary.CountByStatus["succeeded"])
	require.Equal(t, 1, summary.CountByStatus["failed"])
	require.Equal(t, 1, summary.CountByStatus["pending"])
	require.Equal(t, 0, summary.CountByStatus["cancelled"])
	require.Equal(t, 3, summary.CreatedLast24Hours)
	require.NotNil(t, summary.SuccessRatePercent)
	require.InDelta(t, 50.0, *summary.SuccessRatePercent, 0.001)
	require.Len(t, summary.SucceededTotals, 1)
	require.Equal(t, "125050", summary.SucceededTotals[0]["total_amount_minor"], "totals are decimal strings")
}

func TestCurrenciesComeFromTheDatabase(t *testing.T) {
	viewer := newViewer()
	recorder := sendRequest(t, requestOptions{method: http.MethodGet, path: "/v1/currencies", user: &viewer})
	require.Equal(t, http.StatusOK, recorder.Code)
	currencies := decodeJSON[struct {
		Data []struct {
			Code              string `json:"code"`
			MinorUnitExponent int    `json:"minor_unit_exponent"`
		} `json:"data"`
	}](t, recorder).Data
	exponents := map[string]int{}
	for _, currency := range currencies {
		exponents[currency.Code] = currency.MinorUnitExponent
	}
	require.Equal(t, 2, exponents["THB"])
	require.Equal(t, 0, exponents["JPY"])
}

// The database itself must refuse inconsistent rows, even if application code had a bug.
func TestDatabaseConstraintsProtectPaymentInvariants(t *testing.T) {
	resetDatabase(t)
	admin := newAdmin()
	payment := createPayment(t, admin, "constraint-key-0001", validPaymentBody())
	ctx := context.Background()

	_, err := applicationPool.Exec(ctx, `UPDATE payments.payments SET status = 'failed' WHERE id = $1`, payment.ID)
	require.Error(t, err, "failed payments need a failure reason and completed_at")

	_, err = applicationPool.Exec(ctx, `UPDATE payments.payments SET amount_minor = 0 WHERE id = $1`, payment.ID)
	require.Error(t, err, "amount must be positive")

	_, err = applicationPool.Exec(ctx, `UPDATE payments.payment_events SET note = 'tampered'`)
	require.Error(t, err, "payment history is append-only")

	_, err = applicationPool.Exec(ctx, `DELETE FROM payments.payments WHERE id = $1`, payment.ID)
	require.Error(t, err, "the application role may not delete payments")

	_, err = applicationPool.Exec(ctx, `CREATE TABLE payments.attacker_table (id int)`)
	require.Error(t, err, "the application role may not change the schema")
}

func sendRequestWithHeader(t *testing.T, method string, path string, headerName string, headerValue string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	request.Header.Set(headerName, headerValue)
	recorder := httptest.NewRecorder()
	testRouter.ServeHTTP(recorder, request)
	return recorder
}
