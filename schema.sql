-- One row per answer that a reviewer has touched (flags, edits, levels).
CREATE TABLE IF NOT EXISTS review_state (
  answer_id  TEXT PRIMARY KEY,
  state      TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- Append-only audit trail: every applied operation, for the engineering team.
-- `review_state` holds only the current state, so without this there is no way
-- to ask who raised a flag that has since been deleted and purged, or when.
-- Carried over from Chart QA, whose flags were migrated in alongside it
-- (scripts/migrate_chart_flags.py), so the history survived the move.
--
--   wrangler d1 execute answer-review --remote --command \
--     "SELECT answer_id, op, email, at FROM review_events ORDER BY id DESC LIMIT 50"
CREATE TABLE IF NOT EXISTS review_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id TEXT NOT NULL,
  op        TEXT NOT NULL,
  payload   TEXT NOT NULL,
  email     TEXT NOT NULL,
  at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS review_events_answer ON review_events (answer_id, at);
