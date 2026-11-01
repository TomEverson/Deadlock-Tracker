-- Unix start_time at or below which this player's history is known to be
-- complete, from a Game Coordinator walk that wasn't cut short. Incremental
-- syncs page until they overlap it. NULL = never verified, so the next sync
-- walks the whole history (rows seeded from deadlock-api are often sparse).
ALTER TABLE player ADD COLUMN history_verified_until INTEGER;
