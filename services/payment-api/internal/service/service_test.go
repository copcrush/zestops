package service

import (
	"regexp"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/copcrush/zestops/services/payment-api/internal/model"
)

func TestPageCursorRoundTrip(t *testing.T) {
	original := PageCursor{CreatedAt: time.Date(2026, 11, 14, 10, 30, 0, 123456000, time.UTC), ID: uuid.New()}

	decoded, err := DecodePageCursor(original.Encode())

	require.NoError(t, err)
	require.True(t, original.CreatedAt.Equal(decoded.CreatedAt))
	require.Equal(t, original.ID, decoded.ID)
}

func TestDecodePageCursorRejectsGarbage(t *testing.T) {
	for _, invalidCursor := range []string{"!!!", "e30", "bm90LWpzb24", string(make([]byte, 500))} {
		_, err := DecodePageCursor(invalidCursor)
		require.ErrorIs(t, err, ErrInvalidCursor, "cursor %q", invalidCursor)
	}
}

func TestRequestFingerprintChangesWhenBusinessFieldsChange(t *testing.T) {
	baseInput := CreatePaymentInput{
		MerchantReference: "ORDER-1", Description: "d", AmountMinor: 100, Currency: "THB",
		PaymentMethod: model.PaymentMethodCard, IdempotencyKey: "key-aaaaaaaa",
	}
	baseFingerprint, err := calculateRequestFingerprint(baseInput)
	require.NoError(t, err)

	sameInputDifferentKey := baseInput
	sameInputDifferentKey.IdempotencyKey = "key-bbbbbbbb"
	fingerprint, err := calculateRequestFingerprint(sameInputDifferentKey)
	require.NoError(t, err)
	require.Equal(t, baseFingerprint, fingerprint, "the key itself is not part of the fingerprint")

	changedAmount := baseInput
	changedAmount.AmountMinor = 101
	fingerprint, err = calculateRequestFingerprint(changedAmount)
	require.NoError(t, err)
	require.NotEqual(t, baseFingerprint, fingerprint)
}

func TestGeneratePaymentReferenceFormat(t *testing.T) {
	referencePattern := regexp.MustCompile(`^PAY-[0-9A-HJKMNP-TV-Z]{10}$`)
	seenReferences := map[string]bool{}
	for range 200 {
		reference, err := generatePaymentReference()
		require.NoError(t, err)
		require.Regexp(t, referencePattern, reference)
		require.False(t, seenReferences[reference], "duplicate reference generated")
		seenReferences[reference] = true
	}
}
