-- Players we have looked up. `last_viewed_at` drives the cron: anyone viewed
-- in the last 14 days gets their match history refreshed in the background.
CREATE TABLE player (
  account_id INTEGER NOT NULL PRIMARY KEY,          -- SteamID3
  persona_name TEXT,
  avatar_url TEXT,
  profile_url TEXT,
  rank_badge INTEGER,                       -- tier * 10 + subrank, 0 = unranked
  last_synced_at TEXT,                      -- ISO-8601, last successful history sync
  last_force_refetch_at TEXT,               -- ISO-8601, last force_refetch=true call
  last_viewed_at TEXT,
  created_at TEXT NOT NULL
);

-- One row per (player, match) from the match-history endpoint.
CREATE TABLE player_match (
  account_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  hero_id INTEGER NOT NULL,
  start_time INTEGER NOT NULL,              -- unix seconds (game data)
  duration_s INTEGER NOT NULL,
  game_mode INTEGER NOT NULL,
  match_mode INTEGER NOT NULL,
  team INTEGER NOT NULL,                    -- 0 = Hidden King, 1 = Archmother
  won INTEGER NOT NULL,                     -- 0/1
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  net_worth INTEGER NOT NULL,
  last_hits INTEGER NOT NULL,
  denies INTEGER NOT NULL,
  hero_level INTEGER NOT NULL,
  abandoned_time_s INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, match_id)
);
CREATE INDEX idx_player_match_account_time ON player_match (account_id, start_time DESC);

-- Trimmed match metadata (full payload is ~1MB; we keep ~10KB of it).
CREATE TABLE match_detail (
  match_id INTEGER NOT NULL PRIMARY KEY,
  data TEXT NOT NULL,                       -- JSON, see domain/matches/types
  fetched_at TEXT NOT NULL
);

-- Audit trail of every sync attempt, used for cooldowns and debugging.
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  trigger TEXT NOT NULL,                    -- view | manual | force | cron
  status TEXT NOT NULL,                     -- ok | error
  new_matches INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sync_log_account_time ON sync_log (account_id, created_at DESC);
