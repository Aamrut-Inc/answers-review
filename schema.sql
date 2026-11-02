-- One row per answer that a reviewer has touched (flags, edits, levels).
CREATE TABLE IF NOT EXISTS review_state (
  answer_id  TEXT PRIMARY KEY,
  state      TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
