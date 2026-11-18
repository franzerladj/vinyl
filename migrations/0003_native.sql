-- Mitteilungen für die Android-App ohne Browser (gleich wie NATIVE_SCHEMA in server/native.ts)
CREATE TABLE IF NOT EXISTS native_devices (token TEXT PRIMARY KEY, user TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER, ok INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS native_devices_user ON native_devices (user);
CREATE TABLE IF NOT EXISTS native_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, ts INTEGER NOT NULL, msg TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS native_queue_token ON native_queue (token, id);
