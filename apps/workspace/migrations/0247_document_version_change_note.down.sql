-- Reverse 0247: the Änderungsvermerk of a Fassung goes away with its column.

ALTER TABLE "document_versions" DROP CONSTRAINT IF EXISTS "document_versions_change_note_length";
ALTER TABLE "document_versions" DROP COLUMN IF EXISTS "change_note";
