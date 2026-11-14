-- =============================================================================
-- DEMO SEED PAYMENTS (simulated, clearly flagged with is_demo_seed = true).
-- Idempotent: fixed IDs + ON CONFLICT DO NOTHING.
-- =============================================================================
WITH demo_payments (id, reference, merchant_reference, description, amount_minor, currency,
                    payment_method, status, failure_reason, hours_ago) AS (
  VALUES
    ('d0000000-0000-4000-8000-000000000001'::uuid, 'PAY-DEMO000001', 'ORDER-1001', 'Demo: coffee subscription', 45000::bigint, 'THB', 'promptpay', 'succeeded', NULL, 160),
    ('d0000000-0000-4000-8000-000000000002'::uuid, 'PAY-DEMO000002', 'ORDER-1002', 'Demo: annual software license', 129900::bigint, 'USD', 'card', 'succeeded', NULL, 140),
    ('d0000000-0000-4000-8000-000000000003'::uuid, 'PAY-DEMO000003', 'ORDER-1003', 'Demo: hotel deposit', 350000::bigint, 'THB', 'card', 'failed', 'Simulated: card declined by issuer', 120),
    ('d0000000-0000-4000-8000-000000000004'::uuid, 'PAY-DEMO000004', 'ORDER-1004', 'Demo: train tickets', 12800::bigint, 'JPY', 'e_wallet', 'succeeded', NULL, 96),
    ('d0000000-0000-4000-8000-000000000005'::uuid, 'PAY-DEMO000005', 'INV-2026-0042', 'Demo: supplier invoice', 2500000::bigint, 'THB', 'bank_transfer', 'succeeded', NULL, 72),
    ('d0000000-0000-4000-8000-000000000006'::uuid, 'PAY-DEMO000006', 'ORDER-1006', 'Demo: conference ticket', 49900::bigint, 'EUR', 'card', 'cancelled', NULL, 50),
    ('d0000000-0000-4000-8000-000000000007'::uuid, 'PAY-DEMO000007', 'ORDER-1007', 'Demo: grocery delivery', 89050::bigint, 'THB', 'promptpay', 'failed', 'Simulated: insufficient funds', 30),
    ('d0000000-0000-4000-8000-000000000008'::uuid, 'PAY-DEMO000008', 'ORDER-1008', 'Demo: cloud credits', 20000::bigint, 'SGD', 'card', 'succeeded', NULL, 20),
    ('d0000000-0000-4000-8000-000000000009'::uuid, 'PAY-DEMO000009', 'ORDER-1009', 'Demo: office chairs', 1599000::bigint, 'THB', 'bank_transfer', 'pending', NULL, 6),
    ('d0000000-0000-4000-8000-000000000010'::uuid, 'PAY-DEMO000010', 'ORDER-1010', 'Demo: design workshop', 75000::bigint, 'GBP', 'card', 'pending', NULL, 2)
),
inserted AS (
  INSERT INTO payments.payments (
    id, reference, merchant_reference, description, amount_minor, currency, payment_method,
    status, failure_reason, idempotency_key, request_fingerprint, created_by, is_demo_seed,
    created_at, updated_at, completed_at)
  SELECT id, reference, merchant_reference, description, amount_minor, currency, payment_method,
         status, failure_reason,
         'demo-seed-' || right(reference, 6), 'demo-seed',
         '00000000-0000-4000-8000-000000000001'::uuid, true,
         now() - make_interval(hours => hours_ago),
         now() - make_interval(hours => hours_ago) + interval '3 minutes',
         CASE WHEN status IN ('succeeded', 'failed', 'cancelled')
              THEN now() - make_interval(hours => hours_ago) + interval '3 minutes' END
  FROM demo_payments
  ON CONFLICT (id) DO NOTHING
  RETURNING id, status, failure_reason, created_at, completed_at
)
INSERT INTO payments.payment_events (payment_id, from_status, to_status, actor_id, actor_role, note, occurred_at)
SELECT id, NULL, 'pending', '00000000-0000-4000-8000-000000000001'::uuid, 'admin', 'Demo seed: payment created', created_at
FROM inserted
UNION ALL
SELECT id, 'pending', 'processing', '00000000-0000-4000-8000-000000000001'::uuid, 'admin', 'Demo seed: simulation started', created_at + interval '1 minute'
FROM inserted WHERE status IN ('succeeded', 'failed')
UNION ALL
SELECT id, 'processing', status, '00000000-0000-4000-8000-000000000001'::uuid, 'admin', COALESCE(failure_reason, 'Demo seed: simulated success'), completed_at
FROM inserted WHERE status IN ('succeeded', 'failed')
UNION ALL
SELECT id, 'pending', 'cancelled', '00000000-0000-4000-8000-000000000001'::uuid, 'admin', 'Demo seed: cancelled', completed_at
FROM inserted WHERE status = 'cancelled';
