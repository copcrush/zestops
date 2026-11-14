package handler

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/copcrush/zestops/services/payment-api/internal/model"
)

var (
	merchantReferencePattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,64}$`)
	idempotencyKeyPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)
	currencyCodePattern      = regexp.MustCompile(`^[A-Z]{3}$`)
	searchPattern            = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,64}$`)
)

const (
	maximumDescriptionLength   = 280
	maximumFailureReasonLength = 200
	defaultPageSize            = 20
	maximumPageSize            = 100
)

// createPaymentRequest is the JSON body of POST /v1/payments.
// Pointers let us tell "missing" apart from "zero".
type createPaymentRequest struct {
	MerchantReference *string `json:"merchant_reference"`
	Description       *string `json:"description"`
	AmountMinor       *int64  `json:"amount_minor"`
	Currency          *string `json:"currency"`
	PaymentMethod     *string `json:"payment_method"`
}

// validateCreatePaymentRequest checks every field and reports all problems at once.
func validateCreatePaymentRequest(request createPaymentRequest, idempotencyKey string) *model.ValidationError {
	validationError := &model.ValidationError{}

	if !idempotencyKeyPattern.MatchString(idempotencyKey) {
		validationError.Add("Idempotency-Key", "header is required: 8-128 characters of letters, digits, '-' or '_'")
	}

	if request.MerchantReference == nil || !merchantReferencePattern.MatchString(*request.MerchantReference) {
		validationError.Add("merchant_reference", "required: 1-64 characters of letters, digits, '.', '_', ':' or '-'")
	}

	if request.Description != nil {
		description := *request.Description
		if utf8.RuneCountInString(description) > maximumDescriptionLength {
			validationError.Add("description", "must be at most 280 characters")
		} else if containsControlCharacters(description) {
			validationError.Add("description", "must not contain control characters")
		}
	}

	if request.AmountMinor == nil {
		validationError.Add("amount_minor", "required: a positive integer amount in minor units (e.g. satang)")
	} else if *request.AmountMinor <= 0 || *request.AmountMinor > model.MaximumAmountMinor {
		validationError.Add("amount_minor", "must be between 1 and 100000000000")
	}

	if request.Currency == nil || !currencyCodePattern.MatchString(*request.Currency) {
		validationError.Add("currency", "required: a 3-letter uppercase ISO 4217 code such as THB")
	}

	if request.PaymentMethod == nil || !model.PaymentMethod(*request.PaymentMethod).IsValid() {
		validationError.Add("payment_method", "must be one of card, bank_transfer, promptpay, e_wallet")
	}

	if validationError.HasErrors() {
		return validationError
	}
	return nil
}

// simulatePaymentRequest is the JSON body of POST /v1/payments/{id}/simulate.
type simulatePaymentRequest struct {
	Outcome       *string `json:"outcome"`
	FailureReason *string `json:"failure_reason"`
}

func validateSimulatePaymentRequest(request simulatePaymentRequest) *model.ValidationError {
	validationError := &model.ValidationError{}

	outcome := ""
	if request.Outcome != nil {
		outcome = *request.Outcome
	}
	if outcome != string(model.SimulationOutcomeSucceeded) && outcome != string(model.SimulationOutcomeFailed) {
		validationError.Add("outcome", "must be 'succeeded' or 'failed'")
	}

	if request.FailureReason != nil {
		failureReason := strings.TrimSpace(*request.FailureReason)
		switch {
		case outcome == string(model.SimulationOutcomeSucceeded):
			validationError.Add("failure_reason", "is only allowed when outcome is 'failed'")
		case utf8.RuneCountInString(failureReason) > maximumFailureReasonLength:
			validationError.Add("failure_reason", "must be at most 200 characters")
		case containsControlCharacters(failureReason):
			validationError.Add("failure_reason", "must not contain control characters")
		}
	}

	if validationError.HasErrors() {
		return validationError
	}
	return nil
}

func containsControlCharacters(value string) bool {
	for _, character := range value {
		if unicode.IsControl(character) && character != '\n' {
			return true
		}
	}
	return false
}
