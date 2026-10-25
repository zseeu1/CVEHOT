-- No code reads or writes it since a translation retry reuses the receipt's own rejection; deletion approved (2026-10-17).
ALTER TABLE translation_attempts DROP COLUMN IF EXISTS request_tag;
