-- Abgleich zwischen Geräten (gleich wie SCHEMA in server/devsync.ts)
CREATE TABLE IF NOT EXISTS sync_rows (user TEXT NOT NULL, t TEXT NOT NULL, k TEXT NOT NULL, v TEXT, fts TEXT NOT NULL, ts INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (user, t, k));
CREATE INDEX IF NOT EXISTS sync_rows_seq ON sync_rows (user, seq);
CREATE TABLE IF NOT EXISTS sync_meta (user TEXT PRIMARY KEY, seq INTEGER NOT NULL);
