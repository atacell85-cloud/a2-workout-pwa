CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'done', 'failed')),
  source_json TEXT NOT NULL,
  normalized_document_json TEXT NOT NULL,
  preview_json TEXT,
  observability_json TEXT,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS import_jobs_user_status_idx ON import_jobs(user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS import_jobs_id_idx ON import_jobs(id);
