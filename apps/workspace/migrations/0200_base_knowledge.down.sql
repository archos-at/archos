-- Reverse 0200. ORDER: roll the frontend back first; the newer build reads and
-- writes these tables.
--
-- Lossy: every office's base-knowledge records (kind, edition, territory,
-- addressees, licence class) and their checks go. The Archiv documents they
-- describe stay, as ordinary Archiv files; a re-apply starts with no records,
-- and each office confirms its documents again.
DROP TABLE IF EXISTS "knowledge_checks";
DROP TABLE IF EXISTS "knowledge_manifestation_revisions";
DROP TABLE IF EXISTS "knowledge_edition_revisions";
DROP TABLE IF EXISTS "knowledge_work_revisions";
ALTER TABLE IF EXISTS "knowledge_records" DROP CONSTRAINT IF EXISTS "knowledge_records_head_fk";
DROP TABLE IF EXISTS "knowledge_revisions";
DROP TABLE IF EXISTS "knowledge_records";
DROP FUNCTION IF EXISTS knowledge_refuse_cross_owner();
DROP FUNCTION IF EXISTS knowledge_append_only();
DROP FUNCTION IF EXISTS knowledge_records_head_only();
