-- =============================================================================
-- DEMO SEED MONITORING DATA (is_demo_seed = true).
-- psql variables (set by scripts/seed-local.sh):
--   payment_api_health_url, monitoring_api_health_url, unstable_demo_url
-- =============================================================================
INSERT INTO monitoring.services (id, name, description, target_url, expected_status_code,
                                 timeout_ms, degraded_threshold_ms, is_demo_seed, created_by)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'Payment API', 'Go payment service readiness (database connectivity).',
   :'payment_api_health_url', 200, 3000, 800, true, '00000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'Monitoring API', 'Python monitoring service readiness.',
   :'monitoring_api_health_url', 200, 3000, 800, true, '00000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000003', 'Demo Unstable Endpoint', 'Intentionally failing demo endpoint used to showcase incident handling.',
   :'unstable_demo_url', 200, 2000, 500, true, '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Synthetic history for the last 24 hours (one result every 2 hours), only on first seed.
INSERT INTO monitoring.check_results (service_id, status, http_status_code, latency_ms, error_code, error_message, checked_at)
SELECT service_id,
       CASE WHEN service_id = 'e0000000-0000-4000-8000-000000000003'::uuid AND slot % 3 = 0 THEN 'down'
            WHEN slot = 5 THEN 'degraded'
            ELSE 'up' END,
       CASE WHEN service_id = 'e0000000-0000-4000-8000-000000000003'::uuid AND slot % 3 = 0 THEN 503 ELSE 200 END,
       CASE WHEN slot = 5 THEN 950 ELSE 40 + (slot * 7) % 90 END,
       CASE WHEN service_id = 'e0000000-0000-4000-8000-000000000003'::uuid AND slot % 3 = 0 THEN 'UNEXPECTED_STATUS' END,
       CASE WHEN service_id = 'e0000000-0000-4000-8000-000000000003'::uuid AND slot % 3 = 0 THEN 'Demo seed: expected 200, received 503' END,
       now() - make_interval(hours => slot * 2)
FROM (VALUES ('e0000000-0000-4000-8000-000000000001'::uuid),
             ('e0000000-0000-4000-8000-000000000002'::uuid),
             ('e0000000-0000-4000-8000-000000000003'::uuid)) AS services (service_id)
CROSS JOIN generate_series(1, 12) AS slot
WHERE NOT EXISTS (SELECT 1 FROM monitoring.check_results);

WITH inserted AS (
  INSERT INTO monitoring.incidents (id, reference, service_id, title, description, severity, status, source,
                                    created_by, acknowledged_by, acknowledged_at, resolved_by, resolved_at,
                                    resolution_note, is_demo_seed, created_at)
  VALUES
    ('f0000000-0000-4000-8000-000000000001', 'INC-DEMO0001', 'e0000000-0000-4000-8000-000000000001',
     'Demo: elevated payment API latency', 'Demo seed: p95 latency above 800 ms for 20 minutes.',
     'medium', 'resolved', 'manual', '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000001', now() - interval '20 hours',
     '00000000-0000-4000-8000-000000000001', now() - interval '19 hours',
     'Demo seed: connection pool size increased; latency back to normal.', true, now() - interval '21 hours'),
    ('f0000000-0000-4000-8000-000000000002', 'INC-DEMO0002', 'e0000000-0000-4000-8000-000000000003',
     'Demo: unstable endpoint returning 503', 'Demo seed: intermittent 503 responses from the demo endpoint.',
     'high', 'investigating', 'manual', '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000001', now() - interval '3 hours',
     NULL, NULL, NULL, true, now() - interval '4 hours')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, status, created_at, acknowledged_at, resolved_at, resolution_note
)
INSERT INTO monitoring.incident_events (incident_id, event_type, from_status, to_status, note, actor_id, occurred_at)
SELECT id, 'created', NULL, 'open', 'Demo seed: incident created', '00000000-0000-4000-8000-000000000001'::uuid, created_at FROM inserted
UNION ALL
SELECT id, 'status_changed', 'open', 'investigating', 'Demo seed: investigating', '00000000-0000-4000-8000-000000000001'::uuid, acknowledged_at FROM inserted WHERE acknowledged_at IS NOT NULL
UNION ALL
SELECT id, 'status_changed', 'investigating', 'resolved', resolution_note, '00000000-0000-4000-8000-000000000001'::uuid, resolved_at FROM inserted WHERE resolved_at IS NOT NULL;
