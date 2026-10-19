-- When a job is removed from the board (website or app), its final Job Log
-- dates are kept here for 90 days, so every Mac that has the job's .plmj
-- can still write them into the file (see the app's log.js
-- syncTimelines). No customer details: just which file, and the dates.
CREATE TABLE IF NOT EXISTS removed_jobs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  filename TEXT,
  file_path TEXT,
  added_at TEXT,
  paid_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  removed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS removed_jobs_at ON removed_jobs (removed_at);
