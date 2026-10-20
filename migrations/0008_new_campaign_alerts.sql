-- Opt-in email about new campaigns to test: at most one a day, and none again until the user has been back in the app.
ALTER TABLE users ADD COLUMN campaign_alerts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN campaign_alert_at INTEGER;
ALTER TABLE users ADD COLUMN last_seen_at INTEGER;
-- The game owner's once-a-day email about the first new comment on their games.
ALTER TABLE users ADD COLUMN comment_mail_at INTEGER;
