CREATE TABLE IF NOT EXISTS brain_state (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
ON sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
ON sessions (user_id);

CREATE TABLE IF NOT EXISTS user_brain_states (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
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
