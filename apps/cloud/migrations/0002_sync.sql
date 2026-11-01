-- Who may sign in (SteamID3 / account id). role: 'admin' can manage it.
CREATE TABLE allowlist (
  account_id INTEGER NOT NULL PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'member',
  note TEXT,
  added_by INTEGER,
  added_at TEXT NOT NULL
);

-- Shared data, pushed by every install. Same shape as the desktop's local
-- tables minus viewer-relative columns (is_self, is_friend, last_viewed_at…).
CREATE TABLE player (
  account_id INTEGER NOT NULL PRIMARY KEY,
  persona_name TEXT,
  avatar_url TEXT,
  profile_url TEXT,
  rank_badge INTEGER,
  updated_at TEXT NOT NULL            -- last-write-wins for profile fields
);

CREATE TABLE player_match (
  account_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  hero_id INTEGER NOT NULL,
  start_time INTEGER NOT NULL,
  duration_s INTEGER NOT NULL,
  game_mode INTEGER NOT NULL,
  match_mode INTEGER NOT NULL,
  team INTEGER NOT NULL,
  won INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  net_worth INTEGER NOT NULL,
  last_hits INTEGER NOT NULL,
  denies INTEGER NOT NULL,
  hero_level INTEGER NOT NULL,
  abandoned_time_s INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER,
  PRIMARY KEY (account_id, match_id)
);

-- Trimmed match metadata JSON (~36 KB). A higher `v` replaces a lower one.
CREATE TABLE match_detail (
  match_id INTEGER NOT NULL PRIMARY KEY,
  v INTEGER NOT NULL,
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL
);

-- Ordered feed of changes for incremental pulls (GET /v1/pull?since=seq).
CREATE TABLE change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,                  -- player | player_match | match_detail
  k1 INTEGER NOT NULL,                -- account_id or match_id
  k2 INTEGER                          -- match_id for player_match
);
