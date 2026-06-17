CREATE TABLE IF NOT EXISTS brain_state (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invite_requests_status_created
ON invite_requests (status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_requests_pending_email
ON invite_requests (email)
WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS invite_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  email TEXT,
  invite_request_id TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_email
ON invite_codes (email);
