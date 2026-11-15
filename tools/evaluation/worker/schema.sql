CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  session TEXT NOT NULL UNIQUE,
  ids TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY REFERENCES assignments(id),
  payload TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS submissions_pending ON submissions(synced, id);
