-- Device approval for the shared Job Log. A correct password alone no
-- longer signs anything in: it opens a login request, which emails
-- info@ for approval; only an approved request turns into a session.

-- One row per pending/decided sign-in attempt (short-lived; cleaned up
-- after a day). Secrets are stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS login_requests (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,              -- match code shown on the device and in the email
  scope TEXT NOT NULL,             -- 'board' (website) or 'full' (desktop app)
  label TEXT NOT NULL,             -- e.g. "Chrome on iPhone"
  location TEXT,
  poll_hash TEXT NOT NULL,         -- the requesting device's secret
  review_hash TEXT NOT NULL,       -- the email link's secret
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied | claimed
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- One row per approved device. The device holds a random token; only its
-- hash is stored here, so a copy of this table can't sign anyone in.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  label TEXT NOT NULL,
  location TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_token ON sessions (token_hash);
