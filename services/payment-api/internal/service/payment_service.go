// Package service holds the Payment API business logic: idempotent payment
// creation, the simulation workflow, and cancellation. It decides WHAT should
// happen; the repository package decides HOW it is stored.
package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/copcrush/zestops/services/payment-api/internal/auth"
	"github.com/copcrush/zestops/services/payment-api/internal/model"
	"github.com/copcrush/zestops/services/payment-api/internal/repository"
)

// DefaultSimulatedFailureReason is used when an admin simulates a failure
// without giving a reason.
const DefaultSimulatedFailureReason = "Simulated failure"

const maximumReferenceAttempts = 3

// PaymentService implements the payment use cases.
type PaymentService struct {
	repository *repository.PaymentRepository
	logger     *slog.Logger
}

// NewPaymentService wires the service to its repository.
func NewPaymentService(paymentRepository *repository.PaymentRepository, logger *slog.Logger) *PaymentService {
	return &PaymentService{repository: paymentRepository, logger: logger}
}

// CreatePaymentInput is a validated create-payment request.
type CreatePaymentInput struct {
	MerchantReference string
	Description       string
	AmountMinor       int64
	Currency          string
	PaymentMethod     model.PaymentMethod
	IdempotencyKey    string
}

// CreatePaymentResult tells the caller whether a new payment was created or an
// earlier one was returned because the idempotency key was already used.
type CreatePaymentResult struct {
	Payment     model.Payment
	WasReplayed bool
}

// CreatePayment creates a pending payment exactly once per (user, idempotency key).
//
//   - First request with a key      -> new payment (WasReplayed = false)
//   - Retry with same key and body   -> the same payment (WasReplayed = true)
//   - Same key but a different body  -> model.ErrIdempotencyKeyReused
func (paymentService *PaymentService) CreatePayment(ctx context.Context, principal auth.Principal, input CreatePaymentInput, requestID string) (CreatePaymentResult, error) {
	fingerprint, err := calculateRequestFingerprint(input)
	if err != nil {
		return CreatePaymentResult{}, err
	}

	for attempt := 1; attempt <= maximumReferenceAttempts; attempt++ {
		result, err := paymentService.tryCreatePayment(ctx, principal, input, fingerprint, requestID)
		if errors.Is(err, repository.ErrDuplicateReference) {
			paymentService.logger.WarnContext(ctx, "payment reference collision, retrying", "attempt", attempt)
			continue
		}
		return result, err
	}
	return CreatePaymentResult{}, errors.New("could not generate a unique payment reference")
}

func (paymentService *PaymentService) tryCreatePayment(ctx context.Context, principal auth.Principal, input CreatePaymentInput, fingerprint string, requestID string) (CreatePaymentResult, error) {
	reference, err := generatePaymentReference()
	if err != nil {
		return CreatePaymentResult{}, err
	}

	var result CreatePaymentResult
	err = paymentService.repository.RunInTransaction(ctx, func(paymentTransaction *repository.PaymentTransaction) error {
		payment, created, err := paymentTransaction.InsertPaymentIfNew(ctx, repository.InsertPaymentParams{
			Reference:          reference,
			MerchantReference:  input.MerchantReference,
			Description:        input.Description,
			AmountMinor:        input.AmountMinor,
			Currency:           input.Currency,
			PaymentMethod:      input.PaymentMethod,
			IdempotencyKey:     input.IdempotencyKey,
			RequestFingerprint: fingerprint,
			CreatedBy:          principal.UserID,
		})
		if err != nil {
			return err
		}

		if !created {
			existingPayment, err := paymentTransaction.GetPaymentByIdempotencyKey(ctx, principal.UserID, input.IdempotencyKey)
			if err != nil {
				return fmt.Errorf("load payment for idempotency key: %w", err)
			}
			if existingPayment.RequestFingerprint != fingerprint {
				return model.ErrIdempotencyKeyReused
			}
			result = CreatePaymentResult{Payment: existingPayment, WasReplayed: true}
			return nil
		}

		err = paymentTransaction.InsertPaymentEvent(ctx, repository.InsertPaymentEventParams{
			PaymentID: payment.ID,
			ToStatus:  model.PaymentStatusPending,
			ActorID:   principal.UserID,
			ActorRole: principal.Role,
			Note:      "Payment created",
			RequestID: requestID,
		})
		if err != nil {
			return err
		}
		result = CreatePaymentResult{Payment: payment, WasReplayed: false}
		return nil
	})
	if err != nil {
		return CreatePaymentResult{}, err
	}

	if result.WasReplayed {
		paymentService.logger.InfoContext(ctx, "idempotent payment request replayed",
			"payment_id", result.Payment.ID, "actor_id", principal.UserID)
	} else {
		paymentService.logger.InfoContext(ctx, "payment created",
			"payment_id", result.Payment.ID, "reference", result.Payment.Reference,
			"amount_minor", result.Payment.AmountMinor, "currency", result.Payment.Currency,
			"actor_id", principal.UserID)
	}
	return result, nil
}

// SimulatePaymentInput is a validated simulation request.
type SimulatePaymentInput struct {
	Outcome       model.SimulationOutcome
	FailureReason string
}

// SimulatePayment runs the simulated processing workflow for a pending
// payment in one transaction: pending -> processing -> succeeded|failed.
// Only admins may call it (also enforced by the HTTP layer).
//
// Concurrency: the payment row is locked (SELECT ... FOR UPDATE), so if two
// simulations race, the second one waits, then sees a terminal status and
// fails with a state-transition error. A payment can never be settled twice.
func (paymentService *PaymentService) SimulatePayment(ctx context.Context, principal auth.Principal, paymentID uuid.UUID, input SimulatePaymentInput, requestID string) (model.Payment, error) {
	if !principal.IsAdmin() {
		return model.Payment{}, ErrForbidden
	}

	finalStatus := model.PaymentStatusSucceeded
	var failureReason *string
	if input.Outcome == model.SimulationOutcomeFailed {
		finalStatus = model.PaymentStatusFailed
		reason := strings.TrimSpace(input.FailureReason)
		if reason == "" {
			reason = DefaultSimulatedFailureReason
		}
		failureReason = &reason
	}

	var updatedPayment model.Payment
	err := paymentService.repository.RunInTransaction(ctx, func(paymentTransaction *repository.PaymentTransaction) error {
		payment, err := paymentTransaction.GetPaymentForUpdate(ctx, paymentID)
		if err != nil {
			return err
		}

		if !payment.Status.CanTransitionTo(model.PaymentStatusProcessing) {
			return &model.StateTransitionError{CurrentStatus: payment.Status, RequestedStatus: model.PaymentStatusProcessing}
		}
		if _, err := paymentTransaction.UpdatePaymentStatus(ctx, paymentID, model.PaymentStatusProcessing, nil); err != nil {
			return err
		}
		pendingStatus := payment.Status
		if err := paymentTransaction.InsertPaymentEvent(ctx, repository.InsertPaymentEventParams{
			PaymentID: paymentID, FromStatus: &pendingStatus, ToStatus: model.PaymentStatusProcessing,
			ActorID: principal.UserID, ActorRole: principal.Role, Note: "Simulation started", RequestID: requestID,
		}); err != nil {
			return err
		}

		processingStatus := model.PaymentStatusProcessing
		if !processingStatus.CanTransitionTo(finalStatus) {
			return &model.StateTransitionError{CurrentStatus: processingStatus, RequestedStatus: finalStatus}
		}
		updatedPayment, err = paymentTransaction.UpdatePaymentStatus(ctx, paymentID, finalStatus, failureReason)
		if err != nil {
			return err
		}
		note := "Simulated success"
		if failureReason != nil {
			note = *failureReason
		}
		return paymentTransaction.InsertPaymentEvent(ctx, repository.InsertPaymentEventParams{
			PaymentID: paymentID, FromStatus: &processingStatus, ToStatus: finalStatus,
			ActorID: principal.UserID, ActorRole: principal.Role, Note: note, RequestID: requestID,
		})
	})
	if err != nil {
		return model.Payment{}, err
	}

	paymentService.logger.InfoContext(ctx, "payment simulation completed",
		"payment_id", paymentID, "final_status", finalStatus, "actor_id", principal.UserID)
	return updatedPayment, nil
}

// CancelPayment cancels a pending payment (admin only).
func (paymentService *PaymentService) CancelPayment(ctx context.Context, principal auth.Principal, paymentID uuid.UUID, requestID string) (model.Payment, error) {
	if !principal.IsAdmin() {
		return model.Payment{}, ErrForbidden
	}

	var updatedPayment model.Payment
	err := paymentService.repository.RunInTransaction(ctx, func(paymentTransaction *repository.PaymentTransaction) error {
		payment, err := paymentTransaction.GetPaymentForUpdate(ctx, paymentID)
		if err != nil {
			return err
		}
		if !payment.Status.CanTransitionTo(model.PaymentStatusCancelled) {
			return &model.StateTransitionError{CurrentStatus: payment.Status, RequestedStatus: model.PaymentStatusCancelled}
		}
		updatedPayment, err = paymentTransaction.UpdatePaymentStatus(ctx, paymentID, model.PaymentStatusCancelled, nil)
		if err != nil {
			return err
		}
		previousStatus := payment.Status
		return paymentTransaction.InsertPaymentEvent(ctx, repository.InsertPaymentEventParams{
			PaymentID: paymentID, FromStatus: &previousStatus, ToStatus: model.PaymentStatusCancelled,
			ActorID: principal.UserID, ActorRole: principal.Role, Note: "Payment cancelled", RequestID: requestID,
		})
	})
	if err != nil {
		return model.Payment{}, err
	}

	paymentService.logger.InfoContext(ctx, "payment cancelled", "payment_id", paymentID, "actor_id", principal.UserID)
	return updatedPayment, nil
}

// PaymentDetails is a payment together with its status history.
type PaymentDetails struct {
	Payment model.Payment        `json:"payment"`
	Events  []model.PaymentEvent `json:"events"`
}

// GetPaymentDetails returns a payment and its history.
func (paymentService *PaymentService) GetPaymentDetails(ctx context.Context, paymentID uuid.UUID) (PaymentDetails, error) {
	payment, err := paymentService.repository.GetPaymentByID(ctx, paymentID)
	if err != nil {
		return PaymentDetails{}, err
	}
	events, err := paymentService.repository.ListPaymentEvents(ctx, paymentID)
	if err != nil {
		return PaymentDetails{}, err
	}
	return PaymentDetails{Payment: payment, Events: events}, nil
}

// GetPayment returns one payment.
func (paymentService *PaymentService) GetPayment(ctx context.Context, paymentID uuid.UUID) (model.Payment, error) {
	return paymentService.repository.GetPaymentByID(ctx, paymentID)
}

// ListPaymentsInput filters and paginates the payment list.
type ListPaymentsInput struct {
	Status *model.PaymentStatus
	Search *string
	Cursor *PageCursor
	Limit  int
}

// PaymentPage is one page of payments plus the cursor for the next page.
type PaymentPage struct {
	Payments   []model.Payment `json:"data"`
	NextCursor *string         `json:"next_cursor"`
}

// ListPayments returns one page of payments, newest first.
func (paymentService *PaymentService) ListPayments(ctx context.Context, input ListPaymentsInput) (PaymentPage, error) {
	params := repository.ListPaymentsParams{
		Status: input.Status,
		Search: input.Search,
		// Fetch one extra row to know whether another page exists.
		Limit: input.Limit + 1,
	}
	if input.Cursor != nil {
		params.CursorCreatedAt = &input.Cursor.CreatedAt
		params.CursorID = &input.Cursor.ID
	}

	payments, err := paymentService.repository.ListPayments(ctx, params)
	if err != nil {
		return PaymentPage{}, err
	}

	page := PaymentPage{Payments: payments}
	if len(payments) > input.Limit {
		page.Payments = payments[:input.Limit]
		lastPayment := page.Payments[len(page.Payments)-1]
		encodedCursor := PageCursor{CreatedAt: lastPayment.CreatedAt, ID: lastPayment.ID}.Encode()
		page.NextCursor = &encodedCursor
	}
	return page, nil
}

// ListCurrencies returns supported currencies.
func (paymentService *PaymentService) ListCurrencies(ctx context.Context) ([]model.Currency, error) {
	return paymentService.repository.ListCurrencies(ctx)
}

// GetSummary returns dashboard statistics.
func (paymentService *PaymentService) GetSummary(ctx context.Context) (model.PaymentSummary, error) {
	return paymentService.repository.GetSummary(ctx)
}

// ErrForbidden means the caller's role does not allow the action.
var ErrForbidden = errors.New("forbidden")

// calculateRequestFingerprint hashes the business fields of a create request.
// Two requests with the same idempotency key must have the same fingerprint.
func calculateRequestFingerprint(input CreatePaymentInput) (string, error) {
	canonicalRequest, err := json.Marshal(struct {
		MerchantReference string `json:"merchant_reference"`
		Description       string `json:"description"`
		AmountMinor       int64  `json:"amount_minor"`
		Currency          string `json:"currency"`
		PaymentMethod     string `json:"payment_method"`
	}{input.MerchantReference, input.Description, input.AmountMinor, input.Currency, string(input.PaymentMethod)})
	if err != nil {
		return "", fmt.Errorf("encode request fingerprint: %w", err)
	}
	hash := sha256.Sum256(canonicalRequest)
	return hex.EncodeToString(hash[:]), nil
}

// referenceAlphabet is Crockford base32 without easily confused characters.
const referenceAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// generatePaymentReference returns a random, human-friendly reference such as PAY-7K2M9Q4XZD.
func generatePaymentReference() (string, error) {
	randomBytes := make([]byte, 10)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("generate payment reference: %w", err)
	}
	var builder strings.Builder
	builder.WriteString("PAY-")
	for _, randomByte := range randomBytes {
		builder.WriteByte(referenceAlphabet[int(randomByte)%len(referenceAlphabet)])
	}
	return builder.String(), nil
}
