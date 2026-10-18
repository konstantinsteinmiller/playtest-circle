-- Guest accounts (browse and test without Google; upgraded or merged on Google sign-in) and game comments.
ALTER TABLE users ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;

CREATE TABLE game_comments (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX game_comments_game ON game_comments(game_id, created_at DESC);
