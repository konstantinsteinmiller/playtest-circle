-- Games a user hearted, to filter the catalog to their favorites.
CREATE TABLE game_favorites (
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
