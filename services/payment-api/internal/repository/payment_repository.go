// Package repository contains every SQL query of the Payment API.
//
// Rules:
//   - Only parameterized queries ($1, $2, ...). User input is never
//     concatenated into SQL.
//   - Database errors are translated into domain errors from package model,
//     so the service layer never needs to know PostgreSQL error codes.
//   - Multi-step writes run inside RunInTransaction.
package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/copcrush/zestops/services/payment-api/internal/model"
)

// PostgreSQL error codes we react to (https://www.postgresql.org/docs/current/errcodes-appendix.html).
const (
	postgresUniqueViolation     = "23505"
	postgresForeignKeyViolation = "23503"
)

// ErrDuplicateReference means a randomly generated payment reference collided.
var ErrDuplicateReference = errors.New("duplicate payment reference")

// queryRunner is implemented by both *pgxpool.Pool and pgx.Tx, so the same
// query helpers work inside and outside a transaction.
type queryRunner interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, arguments ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
}

const paymentColumns = `id, reference, merchant_reference, description, amount_minor, currency,
	payment_method, status, failure_reason, created_by, is_demo_seed, created_at, updated_at,
	completed_at, request_fingerprint`

// PaymentRepository reads and writes the payments schema.
type PaymentRepository struct {
	pool *pgxpool.Pool
}

// NewPaymentRepository creates a repository backed by a connection pool.
func NewPaymentRepository(pool *pgxpool.Pool) *PaymentRepository {
	return &PaymentRepository{pool: pool}
}

// Ping checks database connectivity (used by the readiness endpoint).
func (repository *PaymentRepository) Ping(ctx context.Context) error {
	return repository.pool.Ping(ctx)
}

// PaymentTransaction exposes the queries that must run inside one transaction.
type PaymentTransaction struct {
	transaction pgx.Tx
}

// RunInTransaction runs work inside a database transaction. If work returns
// an error (or panics) everything is rolled back; otherwise it is committed.
func (repository *PaymentRepository) RunInTransaction(ctx context.Context, work func(paymentTransaction *PaymentTransaction) error) error {
	return pgx.BeginFunc(ctx, repository.pool, func(transaction pgx.Tx) error {
		return work(&PaymentTransaction{transaction: transaction})
	})
}

// InsertPaymentParams holds the values for a new payment row.
type InsertPaymentParams struct {
	Reference          string
	MerchantReference  string
	Description        string
	AmountMinor        int64
	Currency           string
	PaymentMethod      model.PaymentMethod
	IdempotencyKey     string
	RequestFingerprint string
	CreatedBy          uuid.UUID
}

// InsertPaymentIfNew inserts a pending payment unless the same user already
// used the same idempotency key. created is false when the key already exists.
//
// Concurrency: if two requests with the same key arrive at the same time,
// PostgreSQL makes the second INSERT wait on the unique index until the first
// transaction commits; then ON CONFLICT DO NOTHING returns no row.
func (paymentTransaction *PaymentTransaction) InsertPaymentIfNew(ctx context.Context, params InsertPaymentParams) (payment model.Payment, created bool, err error) {
	row := paymentTransaction.transaction.QueryRow(ctx, `
		INSERT INTO payments.payments (
			reference, merchant_reference, description, amount_minor, currency,
			payment_method, status, idempotency_key, request_fingerprint, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
		ON CONFLICT (created_by, idempotency_key) DO NOTHING
		RETURNING `+paymentColumns,
		params.Reference, params.MerchantReference, params.Description, params.AmountMinor,
		params.Currency, params.PaymentMethod, params.IdempotencyKey, params.RequestFingerprint,
		params.CreatedBy)

	payment, err = scanPayment(row)
	if errors.Is(err, model.ErrPaymentNotFound) {
		return model.Payment{}, false, nil
	}
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) {
			if postgresError.Code == postgresForeignKeyViolation {
				return model.Payment{}, false, model.ErrUnsupportedCurrency
			}
			if postgresError.Code == postgresUniqueViolation && postgresError.ConstraintName == "payments_reference_key" {
				return model.Payment{}, false, ErrDuplicateReference
			}
		}
		return model.Payment{}, false, fmt.Errorf("insert payment: %w", err)
	}
	return payment, true, nil
}

// GetPaymentByIdempotencyKey loads the payment a user created with a key.
func (paymentTransaction *PaymentTransaction) GetPaymentByIdempotencyKey(ctx context.Context, createdBy uuid.UUID, idempotencyKey string) (model.Payment, error) {
	row := paymentTransaction.transaction.QueryRow(ctx,
		`SELECT `+paymentColumns+` FROM payments.payments WHERE created_by = $1 AND idempotency_key = $2`,
		createdBy, idempotencyKey)
	return scanPayment(row)
}

// GetPaymentForUpdate loads a payment and locks its row until the transaction
// ends, so concurrent status changes on the same payment run one at a time.
func (paymentTransaction *PaymentTransaction) GetPaymentForUpdate(ctx context.Context, paymentID uuid.UUID) (model.Payment, error) {
	row := paymentTransaction.transaction.QueryRow(ctx,
		`SELECT `+paymentColumns+` FROM payments.payments WHERE id = $1 FOR UPDATE`, paymentID)
	return scanPayment(row)
}

// UpdatePaymentStatus stores a new status. completed_at is set automatically
// for terminal states (the database CHECK constraint also enforces this).
func (paymentTransaction *PaymentTransaction) UpdatePaymentStatus(ctx context.Context, paymentID uuid.UUID, newStatus model.PaymentStatus, failureReason *string) (model.Payment, error) {
	var completedAt *time.Time
	if newStatus.IsTerminal() {
		now := time.Now().UTC()
		completedAt = &now
	}
	row := paymentTransaction.transaction.QueryRow(ctx, `
		UPDATE payments.payments
		SET status = $2, failure_reason = $3, completed_at = $4
		WHERE id = $1
		RETURNING `+paymentColumns,
		paymentID, newStatus, failureReason, completedAt)
	return scanPayment(row)
}

// InsertPaymentEventParams describes one status-history entry.
type InsertPaymentEventParams struct {
	PaymentID  uuid.UUID
	FromStatus *model.PaymentStatus
	ToStatus   model.PaymentStatus
	ActorID    uuid.UUID
	ActorRole  string
	Note       string
	RequestID  string
}

// InsertPaymentEvent appends to the payment's audit trail.
func (paymentTransaction *PaymentTransaction) InsertPaymentEvent(ctx context.Context, params InsertPaymentEventParams) error {
	_, err := paymentTransaction.transaction.Exec(ctx, `
		INSERT INTO payments.payment_events (payment_id, from_status, to_status, actor_id, actor_role, note, request_id)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''))`,
		params.PaymentID, params.FromStatus, params.ToStatus, params.ActorID, params.ActorRole,
		params.Note, params.RequestID)
	if err != nil {
		return fmt.Errorf("insert payment event: %w", err)
	}
	return nil
}

// GetPaymentByID loads one payment.
func (repository *PaymentRepository) GetPaymentByID(ctx context.Context, paymentID uuid.UUID) (model.Payment, error) {
	row := repository.pool.QueryRow(ctx, `SELECT `+paymentColumns+` FROM payments.payments WHERE id = $1`, paymentID)
	return scanPayment(row)
}

// ListPaymentEvents returns a payment's history, oldest first.
func (repository *PaymentRepository) ListPaymentEvents(ctx context.Context, paymentID uuid.UUID) ([]model.PaymentEvent, error) {
	rows, err := repository.pool.Query(ctx, `
		SELECT id, from_status, to_status, actor_id, actor_role, note, request_id, occurred_at
		FROM payments.payment_events
		WHERE payment_id = $1
		ORDER BY occurred_at, id`, paymentID)
	if err != nil {
		return nil, fmt.Errorf("query payment events: %w", err)
	}
	defer rows.Close()

	events := []model.PaymentEvent{}
	for rows.Next() {
		var event model.PaymentEvent
		if err := rows.Scan(&event.ID, &event.FromStatus, &event.ToStatus, &event.ActorID,
			&event.ActorRole, &event.Note, &event.RequestID, &event.OccurredAt); err != nil {
			return nil, fmt.Errorf("scan payment event: %w", err)
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

// ListPaymentsParams filters and paginates the payment list.
type ListPaymentsParams struct {
	Status          *model.PaymentStatus
	Search          *string
	CursorCreatedAt *time.Time
	CursorID        *uuid.UUID
	Limit           int
}

// ListPayments returns payments newest first using keyset pagination: instead
// of OFFSET (slow on large tables), we continue after the last row seen.
func (repository *PaymentRepository) ListPayments(ctx context.Context, params ListPaymentsParams) ([]model.Payment, error) {
	var merchantReferencePrefixPattern *string
	if params.Search != nil {
		pattern := escapeLikePattern(*params.Search) + "%"
		merchantReferencePrefixPattern = &pattern
	}

	rows, err := repository.pool.Query(ctx, `
		SELECT `+paymentColumns+`
		FROM payments.payments
		WHERE ($1::text IS NULL OR status = $1)
		  AND ($2::text IS NULL OR reference = upper($2) OR merchant_reference ILIKE $3 ESCAPE '\')
		  AND ($4::timestamptz IS NULL OR (created_at, id) < ($4, $5::uuid))
		ORDER BY created_at DESC, id DESC
		LIMIT $6`,
		params.Status, params.Search, merchantReferencePrefixPattern,
		params.CursorCreatedAt, params.CursorID, params.Limit)
	if err != nil {
		return nil, fmt.Errorf("query payments: %w", err)
	}
	defer rows.Close()

	payments := []model.Payment{}
	for rows.Next() {
		payment, err := scanPayment(rows)
		if err != nil {
			return nil, err
		}
		payments = append(payments, payment)
	}
	return payments, rows.Err()
}

// ListCurrencies returns every supported currency.
func (repository *PaymentRepository) ListCurrencies(ctx context.Context) ([]model.Currency, error) {
	rows, err := repository.pool.Query(ctx,
		`SELECT code, display_name, minor_unit_exponent FROM payments.currencies ORDER BY code`)
	if err != nil {
		return nil, fmt.Errorf("query currencies: %w", err)
	}
	defer rows.Close()

	currencies := []model.Currency{}
	for rows.Next() {
		var currency model.Currency
		if err := rows.Scan(&currency.Code, &currency.DisplayName, &currency.MinorUnitExponent); err != nil {
			return nil, fmt.Errorf("scan currency: %w", err)
		}
		currencies = append(currencies, currency)
	}
	return currencies, rows.Err()
}

// GetSummary aggregates payment statistics for the dashboard.
func (repository *PaymentRepository) GetSummary(ctx context.Context) (model.PaymentSummary, error) {
	summary := model.PaymentSummary{
		CountByStatus:   map[model.PaymentStatus]int64{},
		SucceededTotals: []model.CurrencyTotal{},
	}
	for _, status := range []model.PaymentStatus{model.PaymentStatusPending, model.PaymentStatusProcessing,
		model.PaymentStatusSucceeded, model.PaymentStatusFailed, model.PaymentStatusCancelled} {
		summary.CountByStatus[status] = 0
	}

	statusRows, err := repository.pool.Query(ctx, `SELECT status, count(*) FROM payments.payments GROUP BY status`)
	if err != nil {
		return summary, fmt.Errorf("count payments by status: %w", err)
	}
	for statusRows.Next() {
		var status model.PaymentStatus
		var count int64
		if err := statusRows.Scan(&status, &count); err != nil {
			statusRows.Close()
			return summary, fmt.Errorf("scan status count: %w", err)
		}
		summary.CountByStatus[status] = count
		summary.TotalCount += count
	}
	statusRows.Close()
	if err := statusRows.Err(); err != nil {
		return summary, err
	}

	totalRows, err := repository.pool.Query(ctx, `
		SELECT currency, sum(amount_minor)::text, count(*)
		FROM payments.payments
		WHERE status = 'succeeded'
		GROUP BY currency
		ORDER BY currency`)
	if err != nil {
		return summary, fmt.Errorf("sum succeeded payments: %w", err)
	}
	for totalRows.Next() {
		var currencyTotal model.CurrencyTotal
		if err := totalRows.Scan(&currencyTotal.Currency, &currencyTotal.TotalAmountMinor, &currencyTotal.PaymentCount); err != nil {
			totalRows.Close()
			return summary, fmt.Errorf("scan currency total: %w", err)
		}
		summary.SucceededTotals = append(summary.SucceededTotals, currencyTotal)
	}
	totalRows.Close()
	if err := totalRows.Err(); err != nil {
		return summary, err
	}

	err = repository.pool.QueryRow(ctx,
		`SELECT count(*) FROM payments.payments WHERE created_at >= now() - interval '24 hours'`).
		Scan(&summary.CreatedLast24Hours)
	if err != nil {
		return summary, fmt.Errorf("count recent payments: %w", err)
	}

	succeeded := summary.CountByStatus[model.PaymentStatusSucceeded]
	failed := summary.CountByStatus[model.PaymentStatusFailed]
	if succeeded+failed > 0 {
		successRate := float64(succeeded) * 100 / float64(succeeded+failed)
		roundedRate := float64(int64(successRate*10+0.5)) / 10
		summary.SuccessRatePercent = &roundedRate
	}
	return summary, nil
}

func scanPayment(row pgx.Row) (model.Payment, error) {
	var payment model.Payment
	err := row.Scan(&payment.ID, &payment.Reference, &payment.MerchantReference, &payment.Description,
		&payment.AmountMinor, &payment.Currency, &payment.PaymentMethod, &payment.Status,
		&payment.FailureReason, &payment.CreatedBy, &payment.IsDemoSeed, &payment.CreatedAt,
		&payment.UpdatedAt, &payment.CompletedAt, &payment.RequestFingerprint)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Payment{}, model.ErrPaymentNotFound
	}
	if err != nil {
		return model.Payment{}, err
	}
	payment.Currency = strings.TrimSpace(payment.Currency)
	return payment, nil
}

// escapeLikePattern makes %, _ and \ match literally in a LIKE/ILIKE pattern.
func escapeLikePattern(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}
