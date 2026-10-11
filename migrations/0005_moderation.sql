-- Moderation: why a user was banned, and warnings they must acknowledge.
ALTER TABLE users ADD COLUMN ban_reason TEXT;

CREATE TABLE user_warnings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER
);
CREATE INDEX user_warnings_user ON user_warnings(user_id, seen_at);
