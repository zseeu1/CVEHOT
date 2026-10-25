-- Temporary feedback bans expire even across application restarts; existing manual bans stay indefinite.
ALTER TABLE feedback_bans ADD COLUMN expires_at timestamptz;
