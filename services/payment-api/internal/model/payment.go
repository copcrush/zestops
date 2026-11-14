// Package model defines the Payment API's domain types and business rules
// that do not depend on HTTP or the database (for example, which payment
// status changes are allowed).
package model

import (
	"time"

	"github.com/google/uuid"
)

// PaymentStatus is the lifecycle state of a simulated payment.
type PaymentStatus string

// All payment states.
const (
	PaymentStatusPending    PaymentStatus = "pending"
	PaymentStatusProcessing PaymentStatus = "processing"
	PaymentStatusSucceeded  PaymentStatus = "succeeded"
	PaymentStatusFailed     PaymentStatus = "failed"
	PaymentStatusCancelled  PaymentStatus = "cancelled"
)

// allowedTransitions is the payment state machine:
//
//	pending ──► processing ──► succeeded
//	   │             └───────► failed
//	   └──► cancelled
//
// Terminal states (succeeded, failed, cancelled) have no outgoing transitions.
var allowedTransitions = map[PaymentStatus][]PaymentStatus{
	PaymentStatusPending:    {PaymentStatusProcessing, PaymentStatusCancelled},
	PaymentStatusProcessing: {PaymentStatusSucceeded, PaymentStatusFailed},
}

// CanTransitionTo reports whether a payment may move from currentStatus to nextStatus.
func (currentStatus PaymentStatus) CanTransitionTo(nextStatus PaymentStatus) bool {
	for _, allowedStatus := range allowedTransitions[currentStatus] {
		if allowedStatus == nextStatus {
			return true
		}
	}
	return false
}

// IsTerminal reports whether no further transitions are possible.
func (currentStatus PaymentStatus) IsTerminal() bool {
	return len(allowedTransitions[currentStatus]) == 0
}

// IsValid reports whether the status is one of the known states.
func (currentStatus PaymentStatus) IsValid() bool {
	switch currentStatus {
	case PaymentStatusPending, PaymentStatusProcessing, PaymentStatusSucceeded,
		PaymentStatusFailed, PaymentStatusCancelled:
		return true
	}
	return false
}

// PaymentMethod is how the (simulated) customer pays.
type PaymentMethod string

// Supported payment methods.
const (
	PaymentMethodCard         PaymentMethod = "card"
	PaymentMethodBankTransfer PaymentMethod = "bank_transfer"
	PaymentMethodPromptPay    PaymentMethod = "promptpay"
	PaymentMethodEWallet      PaymentMethod = "e_wallet"
)

// IsValid reports whether the payment method is supported.
func (paymentMethod PaymentMethod) IsValid() bool {
	switch paymentMethod {
	case PaymentMethodCard, PaymentMethodBankTransfer, PaymentMethodPromptPay, PaymentMethodEWallet:
		return true
	}
	return false
}

// SimulationOutcome is the result an admin chooses when simulating processing.
type SimulationOutcome string

// Supported simulation outcomes.
const (
	SimulationOutcomeSucceeded SimulationOutcome = "succeeded"
	SimulationOutcomeFailed    SimulationOutcome = "failed"
)

// MaximumAmountMinor is the largest allowed single payment, in minor units.
// It stays far below JavaScript's Number.MAX_SAFE_INTEGER (2^53 - 1).
const MaximumAmountMinor int64 = 100_000_000_000

// Payment is a simulated payment. Amounts are integer minor units (ADR-0005).
type Payment struct {
	ID                 uuid.UUID     `json:"id"`
	Reference          string        `json:"reference"`
	MerchantReference  string        `json:"merchant_reference"`
	Description        string        `json:"description"`
	AmountMinor        int64         `json:"amount_minor"`
	Currency           string        `json:"currency"`
	PaymentMethod      PaymentMethod `json:"payment_method"`
	Status             PaymentStatus `json:"status"`
	FailureReason      *string       `json:"failure_reason"`
	CreatedBy          uuid.UUID     `json:"created_by"`
	IsDemoSeed         bool          `json:"is_demo_seed"`
	CreatedAt          time.Time     `json:"created_at"`
	UpdatedAt          time.Time     `json:"updated_at"`
	CompletedAt        *time.Time    `json:"completed_at"`
	RequestFingerprint string        `json:"-"`
}

// PaymentEvent is one entry in a payment's append-only status history.
type PaymentEvent struct {
	ID         int64          `json:"id"`
	FromStatus *PaymentStatus `json:"from_status"`
	ToStatus   PaymentStatus  `json:"to_status"`
	ActorID    uuid.UUID      `json:"actor_id"`
	ActorRole  string         `json:"actor_role"`
	Note       *string        `json:"note"`
	RequestID  *string        `json:"request_id"`
	OccurredAt time.Time      `json:"occurred_at"`
}

// Currency describes a supported currency and its minor unit.
type Currency struct {
	Code              string `json:"code"`
	DisplayName       string `json:"display_name"`
	MinorUnitExponent int    `json:"minor_unit_exponent"`
}

// PaymentSummary aggregates payments for the dashboard.
type PaymentSummary struct {
	TotalCount         int64                   `json:"total_count"`
	CountByStatus      map[PaymentStatus]int64 `json:"count_by_status"`
	SucceededTotals    []CurrencyTotal         `json:"succeeded_totals"`
	CreatedLast24Hours int64                   `json:"created_last_24_hours"`
	SuccessRatePercent *float64                `json:"success_rate_percent"`
}

// CurrencyTotal is the sum of succeeded payments in one currency.
// TotalAmountMinor is a decimal string because sums can exceed 2^53.
type CurrencyTotal struct {
	Currency         string `json:"currency"`
	TotalAmountMinor string `json:"total_amount_minor"`
	PaymentCount     int64  `json:"payment_count"`
}
