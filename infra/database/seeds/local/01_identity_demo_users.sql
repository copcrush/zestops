-- =============================================================================
-- LOCAL DEVELOPMENT DEMO USERS — never run against a shared or production DB.
--   admin@zestops.demo  / LocalAdmin#2026   (role: admin)
--   viewer@zestops.demo / LocalViewer#2026  (role: viewer)
-- Passwords are stored as argon2id hashes (m=19456 KiB, t=2, p=1).
-- For other environments create users with: npm --prefix apps/web run users:create
-- =============================================================================
INSERT INTO identity.users (id, email, display_name, password_hash, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin@zestops.demo', 'Demo Admin',
   '$argon2id$v=19$m=19456,t=2,p=1$6lMKuOmuSIqzSF0J24To5Q$wemQVGqvLjbHiNrOQ7j6ucAKxLmtR7E/wmJlgQK74sI', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'viewer@zestops.demo', 'Demo Viewer',
   '$argon2id$v=19$m=19456,t=2,p=1$lvRdZTF7K2jTBigpVVNw3A$HEQTCn2glWpbkW+Ljs9IQrFY/i75m1pswlWNyBLMM6s', 'viewer')
ON CONFLICT (id) DO NOTHING;
