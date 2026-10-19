-- Job Log board shared by the PLM Job Viewer app and the hidden website
-- page (joblog.html). One row per job card: just what the board shows.
-- The job's full .plmj payload (mockups, photos -- often megabytes) lives
-- in KV under "payload:<id>" instead, since D1 rows are capped at ~2MB
-- and the board itself never needs it.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  filename TEXT,
  file_path TEXT,
  order_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  items TEXT,              -- JSON [{label, quantity}] for custom jobs, else NULL
  card_type_label TEXT,
  has_back INTEGER NOT NULL DEFAULT 0,
  thumbnail TEXT,          -- small JPEG data URL
  status TEXT NOT NULL DEFAULT 'awaiting-payment',
  progress TEXT NOT NULL DEFAULT '{"front":0,"back":0}',
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  started_at TEXT,
  completed_at TEXT
);
