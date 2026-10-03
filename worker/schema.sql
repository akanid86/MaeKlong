PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  type_code TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  location_precision TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  emergency_status TEXT NOT NULL DEFAULT 'active',
  source_type TEXT NOT NULL DEFAULT 'community',
  water_depth TEXT,
  vehicle_access TEXT,
  need_code TEXT,
  people_count INTEGER,
  note TEXT,
  owner_token_hash TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'visible',
  moderation_note TEXT,
  moderated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_reported_at ON reports(reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_type_status ON reports(type_code, emergency_status);
CREATE INDEX IF NOT EXISTS idx_reports_lat_lng ON reports(latitude, longitude);
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

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL
);
