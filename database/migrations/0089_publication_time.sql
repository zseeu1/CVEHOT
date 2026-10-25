-- Keep what the publisher actually supplied: a calendar day or an exact ISO timestamp.
-- Old rows stay unknown; a midnight timestamp cannot recover their original precision.
ALTER TABLE articles ADD COLUMN publication_time text;
