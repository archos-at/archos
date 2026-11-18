-- drop after release 2026-W51: ADR-0182 phase 4, deploy 2, step 3, backfill A (jobs database).
-- The Python backend's two metadata tables key a document by its filename and name the
-- documents it replaces; both follow the rename of namespace.sql. One transaction, as the
-- owner of the jobs database. Idempotent: a second run changes nothing.

BEGIN;

UPDATE document_metadata
   SET filename = 'generated/' || substr(filename, 8)
 WHERE filename LIKE 'piloti/%';

UPDATE document_metadata
   SET superseded_by = 'generated/' || substr(superseded_by, 8)
 WHERE superseded_by LIKE 'piloti/%';

UPDATE document_metadata
   SET revision_suggestion = replace(revision_suggestion, '"piloti/', '"generated/')
 WHERE revision_suggestion LIKE '%"piloti/%';

UPDATE document_revision_retained
   SET filename = 'generated/' || substr(filename, 8)
 WHERE filename LIKE 'piloti/%';

UPDATE document_revision_retained
   SET superseded_by = 'generated/' || substr(superseded_by, 8)
 WHERE superseded_by LIKE 'piloti/%';

UPDATE document_revision_retained
   SET revision_suggestion = replace(revision_suggestion, '"piloti/', '"generated/')
 WHERE revision_suggestion LIKE '%"piloti/%';

COMMIT;
