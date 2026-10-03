-- Run ONCE only when upgrading an existing v0.10 D1 database.
ALTER TABLE reports ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE reports ADD COLUMN moderation_note TEXT;
ALTER TABLE reports ADD COLUMN moderated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_moderation ON reports(moderation_status, reported_at DESC);

CREATE TABLE IF NOT EXISTS report_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  reporter_key TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE(report_id, reporter_key)
);
CREATE INDEX IF NOT EXISTS idx_report_flags_report ON report_flags(report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_log_report ON moderation_log(report_id, created_at DESC);
