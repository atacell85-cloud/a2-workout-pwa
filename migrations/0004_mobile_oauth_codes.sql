CREATE TABLE IF NOT EXISTS mobile_oauth_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS mobile_oauth_codes_hash_idx ON mobile_oauth_codes(code_hash);
CREATE INDEX IF NOT EXISTS mobile_oauth_codes_user_idx ON mobile_oauth_codes(user_id);
