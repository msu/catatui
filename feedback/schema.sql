-- The feedback tables. Run: npx wrangler d1 execute catai-feedback --remote --file schema.sql
-- See src/md/infrastructure/feedback.md.

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  created TEXT NOT NULL,        -- ISO 8601, UTC
  app TEXT NOT NULL,            -- catai or catatui
  version TEXT NOT NULL,
  os TEXT NOT NULL,
  model TEXT,
  kind TEXT NOT NULL,           -- feedback or thumbs-down
  text TEXT NOT NULL,
  conversation TEXT,            -- markdown, only if the student attached it
  netid TEXT,                   -- only if the student allowed contact
  screenshot_key TEXT           -- R2 key in catai-feedback-shots, only if the student attached it
);
CREATE INDEX IF NOT EXISTS reports_created ON reports (created);

-- The rate limit: one row for each report. ip_hash is SHA-256 of IP_SALT and the IP address. at is in ms.
CREATE TABLE IF NOT EXISTS hits (
  ip_hash TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_ip_at ON hits (ip_hash, at);
