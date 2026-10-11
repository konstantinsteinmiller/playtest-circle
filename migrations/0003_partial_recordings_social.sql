-- Why an upload failed on the tester's side (for support), and social-post Credit claims.
ALTER TABLE playtests ADD COLUMN upload_note TEXT;

CREATE TABLE social_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  url TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX social_claims_user ON social_claims(user_id);
