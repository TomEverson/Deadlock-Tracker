-- Steam friends of the `pnpm steam:login` account, refreshed by every
-- `pnpm sync` (no id). Drives the homepage friend list.
ALTER TABLE player ADD COLUMN is_friend INTEGER NOT NULL DEFAULT 0;
