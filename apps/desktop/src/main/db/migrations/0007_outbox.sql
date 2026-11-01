-- Rows waiting to be pushed to the cloud. Triggers enqueue every local change
-- to shared data; rows written while applying a cloud pull are skipped (the
-- sync engine sets sync_state 'cloud.applying' inside that transaction).
CREATE TABLE outbox (
  tbl TEXT NOT NULL,                  -- player | player_match | match_detail
  k1 INTEGER NOT NULL,                -- account_id or match_id
  k2 INTEGER NOT NULL DEFAULT 0,      -- match_id for player_match
  queued_at TEXT NOT NULL,
  PRIMARY KEY (tbl, k1, k2)
);

CREATE TRIGGER outbox_player_insert AFTER INSERT ON player
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'cloud.applying')
BEGIN
  INSERT OR REPLACE INTO outbox (tbl, k1, k2, queued_at) VALUES ('player', NEW.account_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER outbox_player_update AFTER UPDATE OF persona_name, avatar_url, profile_url, rank_badge ON player
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'cloud.applying')
  AND (OLD.persona_name IS NOT NEW.persona_name OR OLD.avatar_url IS NOT NEW.avatar_url OR OLD.profile_url IS NOT NEW.profile_url OR OLD.rank_badge IS NOT NEW.rank_badge)
BEGIN
  INSERT OR REPLACE INTO outbox (tbl, k1, k2, queued_at) VALUES ('player', NEW.account_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER outbox_player_match_insert AFTER INSERT ON player_match
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'cloud.applying')
BEGIN
  INSERT OR IGNORE INTO outbox (tbl, k1, k2, queued_at) VALUES ('player_match', NEW.account_id, NEW.match_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER outbox_match_detail_insert AFTER INSERT ON match_detail
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'cloud.applying')
BEGIN
  INSERT OR REPLACE INTO outbox (tbl, k1, k2, queued_at) VALUES ('match_detail', NEW.match_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER outbox_match_detail_update AFTER UPDATE OF data ON match_detail
WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'cloud.applying')
BEGIN
  INSERT OR REPLACE INTO outbox (tbl, k1, k2, queued_at) VALUES ('match_detail', NEW.match_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

-- Everything already stored goes up on the first cloud sync.
INSERT OR IGNORE INTO outbox (tbl, k1, k2, queued_at) SELECT 'player', account_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM player;
INSERT OR IGNORE INTO outbox (tbl, k1, k2, queued_at) SELECT 'player_match', account_id, match_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM player_match;
INSERT OR IGNORE INTO outbox (tbl, k1, k2, queued_at) SELECT 'match_detail', match_id, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM match_detail;
