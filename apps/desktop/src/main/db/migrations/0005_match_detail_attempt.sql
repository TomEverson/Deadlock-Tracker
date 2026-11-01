-- Failed attempts to download a match's details from Valve (cli/lib/match-details.ts).
-- A match that failed is retried after a day, so one broken match can't eat
-- the daily request budget on every sync.
CREATE TABLE match_detail_attempt (
  match_id INTEGER NOT NULL PRIMARY KEY,
  attempted_at TEXT NOT NULL,                -- ISO-8601
  error TEXT NOT NULL
);
