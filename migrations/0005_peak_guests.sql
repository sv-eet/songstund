-- Track how many guests joined each session (peak concurrent).
ALTER TABLE sessions ADD COLUMN peak_guests INTEGER NOT NULL DEFAULT 0;
