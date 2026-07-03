-- Songs become a per-user library; songbooks reference them through a
-- join table so one song can sit in many songbooks without duplication.
PRAGMA defer_foreign_keys = true;

CREATE TABLE songs_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  lines_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO songs_new (id, user_id, title, author, key, source, lines_json, created_at)
  SELECT s.id, b.user_id, s.title, s.author, s.key, s.source, s.lines_json, s.created_at
  FROM songs s JOIN songbooks b ON b.id = s.songbook_id;

CREATE TABLE songbook_songs (
  songbook_id TEXT NOT NULL REFERENCES songbooks(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (songbook_id, song_id)
);

INSERT INTO songbook_songs (songbook_id, song_id)
  SELECT songbook_id, id FROM songs;

DROP TABLE songs;
ALTER TABLE songs_new RENAME TO songs;

CREATE INDEX idx_songs_user ON songs(user_id);
CREATE INDEX idx_songbook_songs_song ON songbook_songs(song_id);
