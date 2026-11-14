# ADR-0005: Money is stored and transported as integer minor units

- Status: Accepted
- Date: 2026-11-14

## Decision

- Amounts are `amount_minor` integers (satang, cents) in PostgreSQL (`BIGINT`),
  Go (`int64`), Python (`int`) and JSON.
- Each currency has a minor-unit exponent in `payments.currencies`
  (THB 2, USD 2, JPY 0, ...). The Payment API is the single owner of this data
  and exposes it through `GET /v1/currencies`.
- The web form converts a decimal string ("1,250.50") to minor units using
  string arithmetic, never `parseFloat`.
- Maximum single amount is 100,000,000,000 minor units, which stays below
  JavaScript's `Number.MAX_SAFE_INTEGER`. Aggregated totals are returned as
  decimal strings.

## Consequences

No rounding errors such as `0.1 + 0.2 = 0.30000000000000004`.
