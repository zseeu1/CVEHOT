-- Bounded, short-lived submission history serializes retries and rate decisions across API processes.
CREATE TABLE feedback_submission_state (
  source_hash text PRIMARY KEY,
  attempts jsonb NOT NULL DEFAULT '[]',
  submissions jsonb NOT NULL DEFAULT '[]',
  expires_at timestamptz NOT NULL
);
