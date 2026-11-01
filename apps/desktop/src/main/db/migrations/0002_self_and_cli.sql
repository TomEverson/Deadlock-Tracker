-- The Steam account `pnpm steam:login` signed in with. Its page shows
-- `pnpm sync` (no id) as the sync command.
ALTER TABLE player ADD COLUMN is_self INTEGER NOT NULL DEFAULT 0;
