-- Replays: a private one-slot campaign a studio sends to one tester of an earlier playtest, to check its improvements.
ALTER TABLE campaigns ADD COLUMN invited_tester_id TEXT REFERENCES users(id);
ALTER TABLE campaigns ADD COLUMN replay_of TEXT REFERENCES playtests(id);
CREATE INDEX campaigns_invited ON campaigns(invited_tester_id, status) WHERE invited_tester_id IS NOT NULL;
