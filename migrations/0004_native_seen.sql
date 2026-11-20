-- Wann und wodurch die App zuletzt abgeholt hat (Anzeige in den Einstellungen, Fehlersuche)
ALTER TABLE native_devices ADD COLUMN src TEXT;
ALTER TABLE native_devices ADD COLUMN v INTEGER;
ALTER TABLE native_devices ADD COLUMN exempt INTEGER;
