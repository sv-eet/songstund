-- Single-use invite links: signing up through one skips admin approval.
CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_by TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  used_at TEXT
);
