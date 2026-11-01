-- Small key/value store for the sync engine: request logs (budgets), Steam
-- rate-limit backoff, last run results, cloud pull cursor, …
CREATE TABLE sync_state (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);
