-- Persist in-progress call sessions so they survive serverless/multi-instance hosting
CREATE TABLE IF NOT EXISTS call_sessions (
  call_id    TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
