-- Per-session secret for the lead-singer (forsöngvari) link: whoever has
-- it can scroll lines and queue songs, but not end the session.
ALTER TABLE sessions ADD COLUMN cohost_key TEXT;
