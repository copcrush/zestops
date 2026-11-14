// Package handler is where HTTP requests enter the Payment API. Handlers:
//  1. read and validate input (path, query, headers, JSON body),
//  2. call the service layer,
//  3. translate the result or error into a JSON response.
//
// Handlers contain no SQL and no business rules.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/copcrush/zestops/services/payment-api/internal/middleware"
	"github.com/copcrush/zestops/services/payment-api/internal/model"
	"github.com/copcrush/zestops/services/payment-api/internal/service"
)

// PaymentHandler serves the /v1/payments endpoints.
type PaymentHandler struct {
	paymentService *service.PaymentService
	logger         *slog.Logger
}

// NewPaymentHandler creates the handler.
func NewPaymentHandler(paymentService *service.PaymentService, logger *slog.Logger) *PaymentHandler {
	return &PaymentHandler{paymentService: paymentService, logger: logger}
}

// CreatePayment handles POST /v1/payments (admin only).
func (paymentHandler *PaymentHandler) CreatePayment(context *gin.Context) {
	principal, _ := middleware.GetPrincipal(context)

	var request createPaymentRequest
	if !decodeJSONBody(context, &request) {
		return
	}

	idempotencyKey := context.GetHeader("Idempotency-Key")
	if validationError := validateCreatePaymentRequest(request, idempotencyKey); validationError != nil {
		respondValidationError(context, validationError)
		return
	}

	description := ""
	if request.Description != nil {
		description = strings.TrimSpace(*request.Description)
	}

	result, err := paymentHandler.paymentService.CreatePayment(context.Request.Context(), principal, service.CreatePaymentInput{
		MerchantReference: *request.MerchantReference,
		Description:       description,
		AmountMinor:       *request.AmountMinor,
		Currency:          *request.Currency,
		PaymentMethod:     model.PaymentMethod(*request.PaymentMethod),
		IdempotencyKey:    idempotencyKey,
	}, middleware.GetRequestID(context))
	if err != nil {
		paymentHandler.respondServiceError(context, err)
		return
	}

	if result.WasReplayed {
		context.Header("Idempotent-Replayed", "true")
		context.JSON(http.StatusOK, gin.H{"data": result.Payment})
		return
	}
	context.Header("Location", "/v1/payments/"+result.Payment.ID.String())
	context.JSON(http.StatusCreated, gin.H{"data": result.Payment})
}

// ListPayments handles GET /v1/payments?status=&search=&limit=&cursor=
func (paymentHandler *PaymentHandler) ListPayments(context *gin.Context) {
	validationError := &model.ValidationError{}
	input := service.ListPaymentsInput{Limit: defaultPageSize}

	if rawStatus := context.Query("status"); rawStatus != "" {
		status := model.PaymentStatus(rawStatus)
		if !status.IsValid() {
			validationError.Add("status", "must be one of pending, processing, succeeded, failed, cancelled")
		}
		input.Status = &status
	}

	if rawSearch := strings.TrimSpace(context.Query("search")); rawSearch != "" {
		if !searchPattern.MatchString(rawSearch) {
			validationError.Add("search", "must be 1-64 characters of letters, digits, '.', '_', ':' or '-'")
		}
		input.Search = &rawSearch
	}

	if rawLimit := context.Query("limit"); rawLimit != "" {
		limit, err := strconv.Atoi(rawLimit)
		if err != nil || limit < 1 || limit > maximumPageSize {
			validationError.Add("limit", "must be an integer between 1 and 100")
		}
		input.Limit = limit
	}

	if rawCursor := context.Query("cursor"); rawCursor != "" {
		cursor, err := service.DecodePageCursor(rawCursor)
		if err != nil {
			validationError.Add("cursor", "is invalid")
		}
		input.Cursor = &cursor
	}

	if validationError.HasErrors() {
		respondValidationError(context, validationError)
		return
	}

	page, err := paymentHandler.paymentService.ListPayments(context.Request.Context(), input)
	if err != nil {
		paymentHandler.respondServiceError(context, err)
		return
	}
	context.JSON(http.StatusOK, page)
}

// GetPayment handles GET /v1/payments/{paymentId} (payment + history).
func (paymentHandler *PaymentHandler) GetPayment(context *gin.Context) {
	paymentID, ok := parsePaymentID(context)
	if !ok {
		return
	}
	details, err := paymentHandler.paymentService.GetPaymentDetails(context.Request.Context(), paymentID)
	if err != nil {
		paymentHandler.respondServiceError(context, err)
		return
	}
	context.JSON(http.StatusOK, gin.H{"data": details})
}

// GetPaymentStatus handles GET /v1/payments/{paymentId}/status.
func (paymentHandler *PaymentHandler) GetPaymentStatus(context *gin.Context) {
	paymentID, ok := parsePaymentID(context)
	if !ok {
		return
	}
	payment, err := paymentHandler.paymentService.GetPayment(context.Request.Context(), paymentID)
	if err != nil {
		paymentHandler.respondServiceError(context, err)
		return
	}
	context.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":             payment.ID,
		"reference":      payment.Reference,
		"status":         payment.Status,
		"failure_reason": payment.FailureReason,
		"updated_at":     payment.UpdatedAt,
		"completed_at":   payment.CompletedAt,
	}})
}

// SimulatePayment handles POST /v1/payments/{paymentId}/simulate (admin only).
func (paymentHandler *PaymentHandler) SimulatePayment(context *gin.Context) {
	principal, _ := middleware.GetPrincipal(context)
	paymentID, ok := parsePaymentID(context)
	if !ok {
		return
	}

	var request simulatePaymentRequest
	if !decodeJSONBody(context, &request) {
		return
	}
	if validationError := validateSimulatePaymentRequest(request); validationError != nil {
		respondValidationError(context, validationError)
		return
	}

	failureReason := ""
	if request.FailureReason != nil {
		failureReason = *request.FailureReason
	}
	payment, err := paymentHandler.paymentService.SimulatePayment(context.Request.Context(), principal, paymentID,
		service.SimulatePaymentInput{Outcome: model.SimulationOutcome(*request.Outcome), FailureReason: failureReason},
		middleware.GetRequestID(context))
	if err != nil {
		paymentHandler.respondServiceError(context, err)
		return
	}
	context.JSON(http.StatusOK, gin.H{"data": payment})
}

// CancelPayment handles POST /v1/payments/{paymentId}/cancel (admin only).
func (paymentHandler *PaymentHandler) CancelPayment(context *gin.Context) {
	principal, _ := middleware.GetPrincipal(context)
	paymentID, ok := parsePaymentID(context)
	if !ok {
		return
	}
	payment, err := paymentHandler.paymentService.CancelPayment(context.Request.Context(), principal, paymentID,
		middleware.GetRequestID(context))
	if err != nil {
		paymentHandler.respondServiceError(context, err)
		return
	}
	context.JSON(http.StatusOK, gin.H{"data": payment})
}

// GetSummary handles GET /v1/payments/summary.
func (paymentHandler *PaymentHandler) GetSummary(context *gin.Context) {
	summary, err := paymentHandler.paymentService.GetSummary(context.Request.Context())
	if err != nil {
		paymentHandler.respondServiceError(context, err)
		return
	}
	context.JSON(http.StatusOK, gin.H{"data": summary})
}

// ListCurrencies handles GET /v1/currencies.
func (paymentHandler *PaymentHandler) ListCurrencies(context *gin.Context) {
	currencies, err := paymentHandler.paymentService.ListCurrencies(context.Request.Context())
	if err != nil {
		paymentHandler.respondServiceError(context, err)
		return
	}
	context.JSON(http.StatusOK, gin.H{"data": currencies})
}

// respondServiceError maps domain errors to HTTP responses. Unknown errors
// become a generic 500 so internal details (SQL, stack traces) never leak.
func (paymentHandler *PaymentHandler) respondServiceError(context *gin.Context, err error) {
	var transitionError *model.StateTransitionError
	switch {
	case errors.Is(err, model.ErrPaymentNotFound):
		middleware.AbortWithError(context, http.StatusNotFound, "PAYMENT_NOT_FOUND", "Payment not found.", nil)
	case errors.As(err, &transitionError):
		middleware.AbortWithError(context, http.StatusConflict, "INVALID_STATE_TRANSITION", transitionError.Error(),
			gin.H{"current_status": transitionError.CurrentStatus, "requested_status": transitionError.RequestedStatus})
	case errors.Is(err, model.ErrIdempotencyKeyReused):
		middleware.AbortWithError(context, http.StatusUnprocessableEntity, "IDEMPOTENCY_KEY_REUSED",
			"This Idempotency-Key was already used with a different request body.", nil)
	case errors.Is(err, model.ErrUnsupportedCurrency):
		respondValidationError(context, &model.ValidationError{Fields: []model.FieldError{
			{Field: "currency", Message: "is not supported"},
		}})
	case errors.Is(err, service.ErrForbidden):
		middleware.AbortWithError(context, http.StatusForbidden, "FORBIDDEN",
			"You do not have permission to perform this action.", nil)
	default:
		paymentHandler.logger.ErrorContext(context.Request.Context(), "unexpected error",
			"request_id", middleware.GetRequestID(context), "error", err.Error())
		middleware.AbortWithError(context, http.StatusInternalServerError, "INTERNAL_ERROR",
			"An unexpected error occurred.", nil)
	}
}

func respondValidationError(context *gin.Context, validationError *model.ValidationError) {
	middleware.AbortWithError(context, http.StatusBadRequest, "VALIDATION_ERROR",
		"The request contains invalid fields.", validationError.Fields)
}

func parsePaymentID(context *gin.Context) (uuid.UUID, bool) {
	paymentID, err := uuid.Parse(context.Param("paymentId"))
	if err != nil {
		respondValidationError(context, &model.ValidationError{Fields: []model.FieldError{
			{Field: "paymentId", Message: "must be a UUID"},
		}})
		return uuid.Nil, false
	}
	return paymentID, true
}

// decodeJSONBody strictly decodes the body: unknown fields, trailing data and
// non-integer numbers (for int64 fields) are rejected.
func decodeJSONBody(context *gin.Context, destination any) bool {
	if !strings.HasPrefix(context.GetHeader("Content-Type"), "application/json") {
		middleware.AbortWithError(context, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json.", nil)
		return false
	}

	decoder := json.NewDecoder(context.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			middleware.AbortWithError(context, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE",
				"Request body is too large.", nil)
			return false
		}
		middleware.AbortWithError(context, http.StatusBadRequest, "INVALID_JSON",
			"Request body must be valid JSON with only the documented fields and correct types.", nil)
		return false
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		middleware.AbortWithError(context, http.StatusBadRequest, "INVALID_JSON",
			"Request body must contain a single JSON object.", nil)
		return false
	}
	return true
}
