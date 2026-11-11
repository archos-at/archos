-- A source record's protocol and format name code: an access type and a format
-- engine of `packages/public-sources` (`ACCESS_TYPES`, `ENGINES`). Their one list
-- is that registry, generated into the UI's vocabularies
-- (`scripts/generate_vocabularies.py`) and enforced by the record's schema on
-- every write (`bff/base-knowledge/wire/source.ts`). A CHECK here was a third
-- copy that made each new engine a migration (0215 for `pdf_document`). Dropped;
-- no row is touched.
ALTER TABLE "knowledge_source_revisions" DROP CONSTRAINT IF EXISTS knowledge_source_revisions_protocol_known;
--> statement-breakpoint
ALTER TABLE "knowledge_source_revisions" DROP CONSTRAINT IF EXISTS knowledge_source_revisions_format_known;
