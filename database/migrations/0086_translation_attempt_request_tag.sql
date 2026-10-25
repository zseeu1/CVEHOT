-- Preserve the paid request identity across translation storage errors without overwriting the last failure reason.
ALTER TABLE translation_attempts ADD COLUMN request_tag text;
