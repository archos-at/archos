-- Undo 0237: drop the work's document class. Lossy: the classes stated in
-- published records are gone; a text the indexing job already stamped keeps
-- its class in the base corpus.
ALTER TABLE "knowledge_work_revisions" DROP COLUMN IF EXISTS "doc_class";
