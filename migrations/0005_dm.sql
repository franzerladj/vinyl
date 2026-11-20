-- Nachrichten unter Freunden samt Leihanfrage (gleich wie DM_SCHEMA in server/dm.ts)
CREATE TABLE IF NOT EXISTS dm (id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, text TEXT, release_id INTEGER, title TEXT, thumb TEXT, ts INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS dm_pair ON dm (pair, id);
CREATE INDEX IF NOT EXISTS dm_recipient ON dm (recipient, seen);
CREATE INDEX IF NOT EXISTS dm_sender ON dm (sender, ts);
