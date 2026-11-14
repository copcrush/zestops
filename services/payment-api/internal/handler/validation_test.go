package handler

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func pointerTo[T any](value T) *T { return &value }

func validCreateRequest() createPaymentRequest {
	return createPaymentRequest{
		MerchantReference: pointerTo("ORDER-123"),
		Description:       pointerTo("Test order"),
		AmountMinor:       pointerTo(int64(12550)),
		Currency:          pointerTo("THB"),
		PaymentMethod:     pointerTo("promptpay"),
	}
}

func fieldNames(t *testing.T, request createPaymentRequest, idempotencyKey string) []string {
	t.Helper()
	validationError := validateCreatePaymentRequest(request, idempotencyKey)
	if validationError == nil {
		return nil
	}
	names := []string{}
	for _, fieldError := range validationError.Fields {
		names = append(names, fieldError.Field)
	}
	return names
}

func TestValidateCreatePaymentRequestAcceptsValidInput(t *testing.T) {
	require.Nil(t, validateCreatePaymentRequest(validCreateRequest(), "key-12345678"))
}

func TestValidateCreatePaymentRequestRejectsInvalidInput(t *testing.T) {
	testCases := []struct {
		name          string
		modify        func(request *createPaymentRequest)
		idempotency   string
		expectedField string
	}{
		{"missing idempotency key", func(request *createPaymentRequest) {}, "", "Idempotency-Key"},
		{"short idempotency key", func(request *createPaymentRequest) {}, "short", "Idempotency-Key"},
		{"idempotency key with spaces", func(request *createPaymentRequest) {}, "has spaces in it", "Idempotency-Key"},
		{"missing amount", func(request *createPaymentRequest) { request.AmountMinor = nil }, "key-12345678", "amount_minor"},
		{"zero amount", func(request *createPaymentRequest) { request.AmountMinor = pointerTo(int64(0)) }, "key-12345678", "amount_minor"},
		{"negative amount", func(request *createPaymentRequest) { request.AmountMinor = pointerTo(int64(-100)) }, "key-12345678", "amount_minor"},
		{"amount above maximum", func(request *createPaymentRequest) { request.AmountMinor = pointerTo(int64(100_000_000_001)) }, "key-12345678", "amount_minor"},
		{"lowercase currency", func(request *createPaymentRequest) { request.Currency = pointerTo("thb") }, "key-12345678", "currency"},
		{"missing currency", func(request *createPaymentRequest) { request.Currency = nil }, "key-12345678", "currency"},
		{"unknown payment method", func(request *createPaymentRequest) { request.PaymentMethod = pointerTo("cash") }, "key-12345678", "payment_method"},
		{"merchant reference with SQL characters", func(request *createPaymentRequest) {
			request.MerchantReference = pointerTo("1'; DROP TABLE payments;--")
		}, "key-12345678", "merchant_reference"},
		{"merchant reference with HTML", func(request *createPaymentRequest) {
			request.MerchantReference = pointerTo("<script>alert(1)</script>")
		}, "key-12345678", "merchant_reference"},
		{"description too long", func(request *createPaymentRequest) {
			request.Description = pointerTo(strings.Repeat("a", 281))
		}, "key-12345678", "description"},
		{"description with control characters", func(request *createPaymentRequest) {
			request.Description = pointerTo("hello\x00world")
		}, "key-12345678", "description"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			request := validCreateRequest()
			testCase.modify(&request)
			require.Contains(t, fieldNames(t, request, testCase.idempotency), testCase.expectedField)
		})
	}
}

func TestValidateCreatePaymentRequestAcceptsThaiDescriptionUpToLimit(t *testing.T) {
	request := validCreateRequest()
	request.Description = pointerTo(strings.Repeat("ก", 280)) // 280 runes, 840 bytes
	require.Nil(t, validateCreatePaymentRequest(request, "key-12345678"))
}

func TestValidateSimulatePaymentRequest(t *testing.T) {
	require.Nil(t, validateSimulatePaymentRequest(simulatePaymentRequest{Outcome: pointerTo("succeeded")}))
	require.Nil(t, validateSimulatePaymentRequest(simulatePaymentRequest{Outcome: pointerTo("failed"), FailureReason: pointerTo("Card declined")}))
	require.NotNil(t, validateSimulatePaymentRequest(simulatePaymentRequest{}))
	require.NotNil(t, validateSimulatePaymentRequest(simulatePaymentRequest{Outcome: pointerTo("refunded")}))
	require.NotNil(t, validateSimulatePaymentRequest(simulatePaymentRequest{Outcome: pointerTo("succeeded"), FailureReason: pointerTo("x")}))
	require.NotNil(t, validateSimulatePaymentRequest(simulatePaymentRequest{Outcome: pointerTo("failed"), FailureReason: pointerTo(strings.Repeat("x", 201))}))
}
