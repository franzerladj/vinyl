-- Reaktionen, Kommentare, Empfehlungen, Aktivitäts-Liste und eigene Beiträge (gleich wie BUZZ_SCHEMA in server/buzz.ts)
CREATE TABLE IF NOT EXISTS buzz_reactions (owner TEXT NOT NULL, post TEXT NOT NULL, sender TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (owner, post, sender));
CREATE TABLE IF NOT EXISTS buzz_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, post TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS buzz_comments_owner ON buzz_comments (owner, ts);
CREATE TABLE IF NOT EXISTS buzz_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, sender TEXT NOT NULL, kind TEXT NOT NULL, post TEXT, release_id INTEGER, title TEXT, text TEXT, ts INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS buzz_inbox_recipient ON buzz_inbox (recipient, ts);
CREATE TABLE IF NOT EXISTS buzz_posts (owner TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, data TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (owner, kind, ref));
