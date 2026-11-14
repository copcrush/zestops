package model

import (
	"errors"
	"fmt"
	"strings"
)

// Domain errors. Handlers translate these into HTTP responses; the service and
// repository layers never know about HTTP status codes.
var (
	ErrPaymentNotFound        = errors.New("payment not found")
	ErrUnsupportedCurrency    = errors.New("unsupported currency")
	ErrIdempotencyKeyReused   = errors.New("idempotency key was already used with a different request")
	ErrInvalidStateTransition = errors.New("invalid payment state transition")
)

// FieldError describes one invalid input field.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidationError groups every invalid field of a request.
type ValidationError struct {
	Fields []FieldError
}

func (validationError *ValidationError) Error() string {
	messages := make([]string, 0, len(validationError.Fields))
	for _, fieldError := range validationError.Fields {
		messages = append(messages, fieldError.Field+": "+fieldError.Message)
	}
	return "validation failed: " + strings.Join(messages, "; ")
}

// Add records a field problem.
func (validationError *ValidationError) Add(field string, message string) {
	validationError.Fields = append(validationError.Fields, FieldError{Field: field, Message: message})
}

// HasErrors reports whether any field problem was recorded.
func (validationError *ValidationError) HasErrors() bool {
	return len(validationError.Fields) > 0
}

// StateTransitionError explains which transition was rejected.
type StateTransitionError struct {
	CurrentStatus   PaymentStatus
	RequestedStatus PaymentStatus
}

func (transitionError *StateTransitionError) Error() string {
	return fmt.Sprintf("cannot change payment status from %s to %s", transitionError.CurrentStatus, transitionError.RequestedStatus)
}

// Unwrap lets errors.Is(err, ErrInvalidStateTransition) match.
func (transitionError *StateTransitionError) Unwrap() error {
	return ErrInvalidStateTransition
}
