-- Play Testing Circle: initial schema. Timestamps are epoch milliseconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  rep_up INTEGER NOT NULL DEFAULT 0,
  rep_down INTEGER NOT NULL DEFAULT 0,
  discord_webhook TEXT,
  email_opt_in INTEGER NOT NULL DEFAULT 1,
  onboarded_at INTEGER,
  banned_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ledger_user ON credit_ledger(user_id, created_at DESC);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  pitch TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  play_url TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT 'other',
  access_notes TEXT NOT NULL DEFAULT '',
  trailer_url TEXT,
  cover_key TEXT,
  hover_clip_key TEXT,
  screenshots TEXT NOT NULL DEFAULT '[]',
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX games_owner ON games(owner_id);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  build_label TEXT NOT NULL,
  build_url TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  playtime_preset TEXT NOT NULL,
  min_minutes INTEGER NOT NULL,
  slots_total INTEGER NOT NULL,
  slots_paid INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL,
  escrow INTEGER NOT NULL DEFAULT 0 CHECK (escrow >= 0),
  min_reputation INTEGER NOT NULL DEFAULT 0,
  questions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  hidden_at INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX campaigns_browse ON campaigns(status, price DESC, published_at DESC);
CREATE INDEX campaigns_owner ON campaigns(owner_id, created_at DESC);

CREATE TABLE playtests (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  tester_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'reserved',
  reserved_until INTEGER NOT NULL,
  started_at INTEGER,
  stopped_at INTEGER,
  active_ms INTEGER,
  recorder_ms INTEGER,
  used_mic INTEGER NOT NULL DEFAULT 0,
  upload_id TEXT,
  upload_parts TEXT NOT NULL DEFAULT '[]',
  recording_key TEXT,
  recording_bytes INTEGER NOT NULL DEFAULT 0,
  recording_mime TEXT,
  recording_expires_at INTEGER,
  recording_deleted_at INTEGER,
  recording_delete_reason TEXT,
  recording_viewed_at INTEGER,
  expiry_warned_at INTEGER,
  quit_early INTEGER NOT NULL DEFAULT 0,
  answered INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0,
  credits_awarded INTEGER NOT NULL DEFAULT 0,
  payout_reason TEXT,
  dev_rating INTEGER,
  dev_rating_note TEXT NOT NULL DEFAULT '',
  tidy_bonus_at INTEGER,
  submitted_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (campaign_id, tester_id)
);
CREATE INDEX playtests_campaign ON playtests(campaign_id, created_at DESC);
CREATE INDEX playtests_tester ON playtests(tester_id, created_at DESC);
CREATE INDEX playtests_expiry ON playtests(recording_expires_at) WHERE recording_deleted_at IS NULL;

CREATE TABLE answers (
  playtest_id TEXT NOT NULL REFERENCES playtests(id),
  question_id TEXT NOT NULL,
  value INTEGER,
  na INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (playtest_id, question_id)
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  playtest_id TEXT NOT NULL REFERENCES playtests(id),
  offset_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX notes_playtest ON notes(playtest_id, offset_ms);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  expires_at INTEGER NOT NULL
);
