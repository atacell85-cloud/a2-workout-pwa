CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS oauth_accounts_user_idx ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS oauth_accounts_email_idx ON oauth_accounts(email);
